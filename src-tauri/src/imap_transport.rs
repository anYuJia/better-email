//! Bounded IMAP transport, preserving verified TLS on 993 and STARTTLS on
//! other ports. No credentials are sent before a verified TLS handshake.
use crate::db::{MailError, MailResult};
use imap::extensions::idle::SetReadTimeout;
use imap_proto::types::{Response, Status};
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::mpsc;
use std::time::{Duration, Instant};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const ADDRESS_TIMEOUT: Duration = Duration::from_secs(3);
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(30);
const IO_TIMEOUT: Duration = Duration::from_secs(20);
const SESSION_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Clone, Copy)]
pub(crate) enum SessionPolicy {
    Command,
    /// Bodies, attachments, APPEND and bulk sync may legitimately transfer
    /// longer than three minutes. Bound inactivity, not healthy progress.
    Transfer,
}

impl SessionPolicy {
    fn deadline(self, started: Instant) -> Option<Instant> {
        match self {
            Self::Command => Some(started + SESSION_TIMEOUT),
            Self::Transfer => None,
        }
    }
}

struct BoundedTls {
    stream: native_tls::TlsStream<TcpStream>,
    deadline: Option<Instant>,
    read_timeout: Duration,
    _deadline_guard: Option<ConnectionDeadline>,
}

struct ConnectionDeadline(mpsc::Sender<()>);

impl ConnectionDeadline {
    fn start(socket: &TcpStream, duration: Duration) -> std::io::Result<Self> {
        let socket = socket.try_clone()?;
        let (sender, receiver) = mpsc::channel();
        std::thread::Builder::new()
            .name("imap-deadline".into())
            .spawn(move || {
                if matches!(
                    receiver.recv_timeout(duration),
                    Err(mpsc::RecvTimeoutError::Timeout)
                ) {
                    let _ = socket.shutdown(std::net::Shutdown::Both);
                }
            })?;
        Ok(Self(sender))
    }
}
impl Drop for ConnectionDeadline {
    fn drop(&mut self) {
        let _ = self.0.send(());
    }
}

impl BoundedTls {
    fn remaining(&self) -> std::io::Result<Duration> {
        let Some(deadline) = self.deadline else {
            return Ok(IO_TIMEOUT);
        };
        deadline
            .checked_duration_since(Instant::now())
            .filter(|remaining| !remaining.is_zero())
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::TimedOut, "IMAP 会话超时"))
    }
}

impl Read for BoundedTls {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        self.stream
            .get_ref()
            .set_read_timeout(Some(self.remaining()?.min(self.read_timeout)))?;
        self.stream.read(buffer)
    }
}
impl Write for BoundedTls {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.stream
            .get_ref()
            .set_write_timeout(Some(self.remaining()?.min(IO_TIMEOUT)))?;
        self.stream.write(bytes)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.stream
            .get_ref()
            .set_write_timeout(Some(self.remaining()?.min(IO_TIMEOUT)))?;
        self.stream.flush()
    }
}
impl SetReadTimeout for BoundedTls {
    fn set_read_timeout(&mut self, timeout: Option<Duration>) -> imap::Result<()> {
        self.read_timeout = timeout.unwrap_or(IO_TIMEOUT).min(IO_TIMEOUT);
        Ok(())
    }
}

fn interleave_addresses(addresses: Vec<SocketAddr>) -> Vec<SocketAddr> {
    let first_is_v6 = addresses.first().is_some_and(SocketAddr::is_ipv6);
    let (mut v6, mut v4): (VecDeque<_>, VecDeque<_>) =
        addresses.into_iter().partition(SocketAddr::is_ipv6);
    let mut ordered = Vec::with_capacity(v6.len() + v4.len());
    let (first, second) = if first_is_v6 {
        (&mut v6, &mut v4)
    } else {
        (&mut v4, &mut v6)
    };
    while !first.is_empty() || !second.is_empty() {
        if let Some(address) = first.pop_front() {
            ordered.push(address);
        }
        if let Some(address) = second.pop_front() {
            ordered.push(address);
        }
    }
    ordered
}

fn connect_addresses<T>(
    addresses: Vec<SocketAddr>,
    mut elapsed: impl FnMut() -> Duration,
    mut attempt: impl FnMut(SocketAddr, Duration) -> std::io::Result<T>,
) -> std::io::Result<T> {
    let address_limit = if addresses.len() > 1 {
        ADDRESS_TIMEOUT
    } else {
        CONNECT_TIMEOUT
    };
    let mut last_error = std::io::Error::new(std::io::ErrorKind::NotFound, "服务器没有可用地址");
    for address in interleave_addresses(addresses) {
        let Some(remaining) = CONNECT_TIMEOUT
            .checked_sub(elapsed())
            .filter(|time| !time.is_zero())
        else {
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "IMAP 连接超时",
            ));
        };
        match attempt(address, remaining.min(address_limit)) {
            Ok(stream) => return Ok(stream),
            Err(error) => last_error = error,
        }
    }
    Err(last_error)
}

pub(crate) fn connect(
    host: &str,
    port: u16,
    policy: SessionPolicy,
) -> MailResult<imap::Client<imap::Connection>> {
    let started = Instant::now();
    // DNS uses the system resolver. TCP/TLS/read/write deadlines are bounded;
    // resolution runs only on the bounded network pool, never a UI worker.
    let addresses = (host, port).to_socket_addrs()?.collect();
    let mut tcp = connect_addresses(
        addresses,
        || started.elapsed(),
        |address, timeout| TcpStream::connect_timeout(&address, timeout),
    )
    .map_err(|error| MailError::Imap(format!("IMAP 连接失败或超时：{error}")))?;
    tcp.set_read_timeout(Some(IO_TIMEOUT))?;
    tcp.set_write_timeout(Some(IO_TIMEOUT))?;
    // STARTTLS/greeting/TLS must finish even if a peer trickles handshake
    // bytes. Transfer sessions drop this guard only after verified TLS.
    let handshake_guard = ConnectionDeadline::start(&tcp, HANDSHAKE_TIMEOUT)?;
    let greeting_read = port != 993;
    if greeting_read {
        request_starttls(&mut tcp)?;
    }
    let connector = native_tls::TlsConnector::new()
        .map_err(|error| MailError::Imap(format!("TLS 初始化失败：{error}")))?;
    let stream = connector
        .connect(host, tcp)
        .map_err(|error| MailError::Imap(format!("IMAP TLS 握手失败：{error}")))?;
    let deadline = policy.deadline(started);
    let deadline_guard = deadline
        .map(|deadline| {
            ConnectionDeadline::start(
                stream.get_ref(),
                deadline.saturating_duration_since(Instant::now()),
            )
        })
        .transpose()?;
    let transport: imap::Connection = Box::new(BoundedTls {
        stream,
        deadline,
        read_timeout: IO_TIMEOUT,
        _deadline_guard: deadline_guard,
    });
    let mut client = imap::Client::new(transport);
    if greeting_read {
        client.greeting_read = true;
    } else {
        client
            .read_greeting()
            .map_err(|error| MailError::Imap(format!("IMAP 欢迎响应失败：{error}")))?;
    }
    drop(handshake_guard);
    Ok(client)
}

fn request_starttls(tcp: &mut TcpStream) -> MailResult<()> {
    const MAX_LINE: u64 = 16 * 1024;
    let mut reader = BufReader::new(tcp);
    let mut line = Vec::new();
    reader
        .by_ref()
        .take(MAX_LINE)
        .read_until(b'\n', &mut line)?;
    if !matches!(
        imap_proto::parser::parse_response(&line),
        Ok((
            _,
            Response::Data {
                status: Status::Ok,
                ..
            }
        ))
    ) {
        return Err(MailError::Imap("IMAP 欢迎响应无效，未发送凭据。".into()));
    }
    reader.get_mut().write_all(b"BE_STARTTLS STARTTLS\r\n")?;
    reader.get_mut().flush()?;
    for _ in 0..64 {
        line.clear();
        reader
            .by_ref()
            .take(MAX_LINE)
            .read_until(b'\n', &mut line)?;
        match imap_proto::parser::parse_response(&line) {
            Ok((_, Response::Done { tag, status, .. })) if tag.0 == "BE_STARTTLS" => {
                if status == Status::Ok && reader.buffer().is_empty() {
                    return Ok(());
                }
                return Err(MailError::Imap(
                    "服务器未接受 STARTTLS，未发送凭据。".into(),
                ));
            }
            Ok((
                _,
                Response::Data {
                    status: Status::Bye,
                    ..
                },
            ))
            | Err(_) => break,
            _ => {}
        }
    }
    Err(MailError::Imap(
        "IMAP STARTTLS 响应无效或过长，未发送凭据。".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::net::TcpListener;

    #[test]
    fn blackholed_ipv6_keeps_an_ipv4_fallback_within_the_total_budget() {
        let ipv6: SocketAddr = "[::1]:993".parse().unwrap();
        let other_ipv6: SocketAddr = "[::2]:993".parse().unwrap();
        let ipv4: SocketAddr = "127.0.0.1:993".parse().unwrap();
        let elapsed = Cell::new(Duration::ZERO);
        let mut attempts = Vec::new();
        let connected = connect_addresses(
            vec![ipv6, other_ipv6, ipv4],
            || elapsed.get(),
            |address, budget| {
                attempts.push((address, budget));
                if address.is_ipv6() {
                    // Model a blackhole consuming its entire attempt budget.
                    elapsed.set(elapsed.get() + budget);
                    Err(std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        "blackhole",
                    ))
                } else {
                    Ok(address)
                }
            },
        )
        .unwrap();
        assert_eq!(connected, ipv4);
        assert_eq!(
            attempts,
            vec![
                (ipv6, Duration::from_secs(3)),
                (ipv4, Duration::from_secs(3))
            ]
        );
        assert!(elapsed.get() < CONNECT_TIMEOUT);
    }

    #[test]
    fn address_fallback_never_exceeds_the_shared_connection_budget() {
        let addresses = (1..7)
            .map(|last| SocketAddr::from(([127, 0, 0, last], 993)))
            .collect();
        let elapsed = Cell::new(Duration::ZERO);
        let mut budgets = Vec::new();
        let result: std::io::Result<()> = connect_addresses(
            addresses,
            || elapsed.get(),
            |_, budget| {
                budgets.push(budget);
                elapsed.set(elapsed.get() + budget);
                Err(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    "blackhole",
                ))
            },
        );
        assert!(result.is_err());
        assert_eq!(
            budgets,
            vec![
                Duration::from_secs(3),
                Duration::from_secs(3),
                Duration::from_secs(3),
                Duration::from_secs(1)
            ]
        );
        assert_eq!(elapsed.get(), CONNECT_TIMEOUT);
    }

    #[test]
    fn healthy_bulk_transfers_do_not_have_a_three_minute_cutoff() {
        let started = Instant::now();
        let after_large_transfer = started + Duration::from_secs(270);
        assert!(SessionPolicy::Command.deadline(started).unwrap() < after_large_transfer);
        assert!(SessionPolicy::Transfer.deadline(started).is_none());
        // Both policies retain the same per-I/O inactivity bound.
        assert_eq!(IO_TIMEOUT, Duration::from_secs(20));
    }

    #[test]
    fn starttls_accepts_a_valid_tagged_upgrade_response() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .write_all(b"* OK [CAPABILITY IMAP4rev1 STARTTLS] ready\r\n")
                .unwrap();
            let mut reader = BufReader::new(socket);
            let mut request = String::new();
            reader.read_line(&mut request).unwrap();
            assert_eq!(request, "BE_STARTTLS STARTTLS\r\n");
            reader
                .get_mut()
                .write_all(b"* OK upgrading\r\nBE_STARTTLS OK begin TLS\r\n")
                .unwrap();
        });
        let mut client = TcpStream::connect(address).unwrap();
        client
            .set_read_timeout(Some(Duration::from_secs(1)))
            .unwrap();
        request_starttls(&mut client).unwrap();
        server.join().unwrap();
    }

    #[test]
    fn starttls_requires_success_and_never_sends_credentials_in_plaintext() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket.write_all(b"* OK synthetic IMAP\r\n").unwrap();
            let mut reader = BufReader::new(socket);
            let mut request = String::new();
            reader.read_line(&mut request).unwrap();
            assert_eq!(request, "BE_STARTTLS STARTTLS\r\n");
            reader
                .get_mut()
                .write_all(b"BE_STARTTLS NO disabled\r\n")
                .unwrap();
        });
        let mut client = TcpStream::connect(address).unwrap();
        client
            .set_read_timeout(Some(Duration::from_secs(1)))
            .unwrap();
        assert!(request_starttls(&mut client)
            .unwrap_err()
            .to_string()
            .contains("未发送凭据"));
        server.join().unwrap();
    }

    #[test]
    fn silent_greeting_obeys_socket_deadline() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let mut client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (_peer, _) = listener.accept().unwrap();
        client
            .set_read_timeout(Some(Duration::from_millis(30)))
            .unwrap();
        let start = Instant::now();
        assert!(request_starttls(&mut client).is_err());
        assert!(start.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn absolute_deadline_interrupts_a_socket_even_without_idle_timeout() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let mut client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (_peer, _) = listener.accept().unwrap();
        let _guard = ConnectionDeadline::start(&client, Duration::from_millis(30)).unwrap();
        let started = Instant::now();
        let mut byte = [0];
        assert!(!matches!(client.read(&mut byte), Ok(length) if length > 0));
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}
