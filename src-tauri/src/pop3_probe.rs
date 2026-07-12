use crate::credentials::AccountSecret;
use crate::db::MailError;
use crate::models::Account;
use native_tls::{TlsConnector, TlsStream};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::time::Duration;

const DEFAULT_POP3_TLS_PORT: u16 = 995;
const POP3_TIMEOUT: Duration = Duration::from_secs(20);
const POP3_SYNC_LIMIT: usize = 25;

#[derive(Debug, Clone)]
pub struct Pop3Message {
    pub remote_uid: i64,
    pub raw: String,
}

enum Pop3Stream {
    Plain(TcpStream),
    Tls(TlsStream<TcpStream>),
}

impl Read for Pop3Stream {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        match self {
            Pop3Stream::Plain(stream) => stream.read(buf),
            Pop3Stream::Tls(stream) => stream.read(buf),
        }
    }
}

impl Write for Pop3Stream {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        match self {
            Pop3Stream::Plain(stream) => stream.write(buf),
            Pop3Stream::Tls(stream) => stream.write(buf),
        }
    }

    fn flush(&mut self) -> std::io::Result<()> {
        match self {
            Pop3Stream::Plain(stream) => stream.flush(),
            Pop3Stream::Tls(stream) => stream.flush(),
        }
    }
}

pub fn verify_credentials(account: &Account, secret: &AccountSecret) -> Result<(), MailError> {
    let mut client = Pop3Client::connect(account)?;
    client.login(account, secret)?;
    client.quit();
    Ok(())
}

pub fn fetch_recent_messages(
    account: &Account,
    secret: &AccountSecret,
) -> Result<Vec<Pop3Message>, MailError> {
    let mut client = Pop3Client::connect(account)?;
    client.login(account, secret)?;
    let uidls = client.uidl()?;
    let start = uidls.len().saturating_sub(POP3_SYNC_LIMIT);
    let mut messages = Vec::new();
    for (number, uidl) in uidls.into_iter().skip(start) {
        let raw = client.retr(number)?;
        messages.push(Pop3Message {
            remote_uid: remote_uid_from_uidl(&uidl),
            raw,
        });
    }
    client.quit();
    Ok(messages)
}

struct Pop3Client {
    reader: BufReader<Pop3Stream>,
}

impl Pop3Client {
    fn connect(account: &Account) -> Result<Self, MailError> {
        let (host, port) = parse_pop3_endpoint(&account.imap_host)?;
        let tcp = TcpStream::connect((host.as_str(), port))
            .map_err(|error| MailError::Imap(format!("POP3 连接失败：{error}")))?;
        tcp.set_read_timeout(Some(POP3_TIMEOUT)).ok();
        tcp.set_write_timeout(Some(POP3_TIMEOUT)).ok();
        let stream = if port == DEFAULT_POP3_TLS_PORT {
            let connector = TlsConnector::new()
                .map_err(|error| MailError::Imap(format!("POP3 TLS 初始化失败：{error}")))?;
            Pop3Stream::Tls(
                connector
                    .connect(&host, tcp)
                    .map_err(|error| MailError::Imap(format!("POP3 TLS 握手失败：{error}")))?,
            )
        } else {
            Pop3Stream::Plain(tcp)
        };
        let mut client = Self {
            reader: BufReader::new(stream),
        };
        client.read_status()?;
        Ok(client)
    }

    fn login(&mut self, account: &Account, secret: &AccountSecret) -> Result<(), MailError> {
        let password = match secret {
            AccountSecret::Password(password) => password,
            AccountSecret::OAuth2(_) => {
                return Err(MailError::Imap(
                    "POP3 暂不支持 OAuth2 登录，请使用服务商授权码。".to_string(),
                ));
            }
        };
        self.command(&format!("USER {}", account.email))?;
        self.command(&format!("PASS {password}"))?;
        Ok(())
    }

    fn uidl(&mut self) -> Result<Vec<(i64, String)>, MailError> {
        let lines = self.multiline_command("UIDL")?;
        let mut uidls = Vec::new();
        for line in lines {
            let mut parts = line.split_whitespace();
            let Some(number) = parts.next().and_then(|value| value.parse::<i64>().ok()) else {
                continue;
            };
            let Some(uidl) = parts.next() else {
                continue;
            };
            uidls.push((number, uidl.to_string()));
        }
        Ok(uidls)
    }

    fn retr(&mut self, number: i64) -> Result<String, MailError> {
        Ok(self
            .multiline_command(&format!("RETR {number}"))?
            .join("\r\n"))
    }

    fn quit(&mut self) {
        let _ = self.command("QUIT");
    }

    fn command(&mut self, command: &str) -> Result<String, MailError> {
        self.write_command(command)?;
        self.read_status()
    }

    fn multiline_command(&mut self, command: &str) -> Result<Vec<String>, MailError> {
        self.write_command(command)?;
        self.read_status()?;
        let mut lines = Vec::new();
        loop {
            let line = self.read_line()?;
            if line == "." {
                break;
            }
            lines.push(line.strip_prefix("..").unwrap_or(&line).to_string());
        }
        Ok(lines)
    }

    fn write_command(&mut self, command: &str) -> Result<(), MailError> {
        let stream = self.reader.get_mut();
        stream
            .write_all(format!("{command}\r\n").as_bytes())
            .map_err(|error| MailError::Imap(format!("POP3 命令发送失败：{error}")))?;
        stream
            .flush()
            .map_err(|error| MailError::Imap(format!("POP3 命令发送失败：{error}")))
    }

    fn read_status(&mut self) -> Result<String, MailError> {
        let line = self.read_line()?;
        if line.starts_with("+OK") {
            Ok(line)
        } else {
            Err(MailError::Imap(format!("POP3 返回错误：{line}")))
        }
    }

    fn read_line(&mut self) -> Result<String, MailError> {
        let mut line = String::new();
        self.reader
            .read_line(&mut line)
            .map_err(|error| MailError::Imap(format!("POP3 响应读取失败：{error}")))?;
        if line.is_empty() {
            return Err(MailError::Imap("POP3 连接已关闭。".to_string()));
        }
        Ok(line.trim_end_matches(['\r', '\n']).to_string())
    }
}

fn parse_pop3_endpoint(configured: &str) -> Result<(String, u16), MailError> {
    let trimmed = configured.trim();
    if trimmed.is_empty() {
        return Err(MailError::Imap("未配置 POP3 服务器。".to_string()));
    }
    if let Some((host, port)) = trimmed.rsplit_once(':') {
        if host.trim().is_empty() {
            return Err(MailError::Imap("POP3 服务器缺少主机名。".to_string()));
        }
        let parsed_port = port
            .parse::<u16>()
            .map_err(|_| MailError::Imap("POP3 端口格式无效，应为 1-65535。".to_string()))?;
        Ok((host.trim().to_string(), parsed_port))
    } else {
        Ok((trimmed.to_string(), DEFAULT_POP3_TLS_PORT))
    }
}

fn remote_uid_from_uidl(uidl: &str) -> i64 {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in uidl.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    (hash & 0x7fff_ffff_ffff_ffff) as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pop3_endpoint_defaults_to_tls_port() {
        assert_eq!(
            parse_pop3_endpoint("pop.example.com").unwrap(),
            ("pop.example.com".to_string(), 995)
        );
        assert_eq!(
            parse_pop3_endpoint("pop.example.com:110").unwrap(),
            ("pop.example.com".to_string(), 110)
        );
    }

    #[test]
    fn uidl_hash_is_stable_positive_number() {
        assert_eq!(remote_uid_from_uidl("abc"), remote_uid_from_uidl("abc"));
        assert!(remote_uid_from_uidl("abc") > 0);
    }
}
