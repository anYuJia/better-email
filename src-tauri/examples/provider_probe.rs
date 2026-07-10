use better_email_lib::{list_provider_probe_accounts, run_provider_probe};
use std::path::PathBuf;

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut database_path = default_database_path();
    let mut account_id = None;
    let mut list_only = false;
    let mut arguments = std::env::args().skip(1);

    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--database" => {
                database_path = Some(PathBuf::from(
                    arguments
                        .next()
                        .ok_or_else(|| "--database 缺少路径。".to_string())?,
                ));
            }
            "--account-id" => {
                let raw = arguments
                    .next()
                    .ok_or_else(|| "--account-id 缺少数值。".to_string())?;
                account_id = Some(
                    raw.parse::<i64>()
                        .map_err(|_| format!("无效账号 ID：{raw}"))?,
                );
            }
            "--list" => list_only = true,
            "--help" | "-h" => {
                print_usage();
                return Ok(());
            }
            other => return Err(format!("未知参数：{other}")),
        }
    }

    let database_path = database_path.ok_or_else(|| {
        "无法推导 Better Email 数据库路径，请通过 --database 显式指定。".to_string()
    })?;
    if list_only {
        let accounts = list_provider_probe_accounts(&database_path)?;
        println!(
            "{}",
            serde_json::to_string_pretty(&accounts)
                .map_err(|error| format!("序列化账号列表失败：{error}"))?
        );
        return Ok(());
    }

    let account_id =
        account_id.ok_or_else(|| "请提供 --account-id，或使用 --list 查看账号。".to_string())?;
    let report = run_provider_probe(&database_path, account_id)?;
    println!(
        "{}",
        serde_json::to_string_pretty(&report)
            .map_err(|error| format!("序列化验收报告失败：{error}"))?
    );
    if report.status == "ok" {
        Ok(())
    } else {
        Err(format!("服务商验收状态：{}", report.status))
    }
}

fn default_database_path() -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        return std::env::var_os("HOME").map(|home| {
            PathBuf::from(home)
                .join("Library/Application Support/app.betteremail.client/better-email.sqlite3")
        });
    }
    if cfg!(target_os = "windows") {
        return std::env::var_os("APPDATA").map(|app_data| {
            PathBuf::from(app_data)
                .join("app.betteremail.client")
                .join("better-email.sqlite3")
        });
    }
    std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")))
        .map(|data| {
            data.join("app.betteremail.client")
                .join("better-email.sqlite3")
        })
}

fn print_usage() {
    println!(
        "Better Email 只读服务商验收\n\
         \n\
         用法：\n\
         cargo run --manifest-path src-tauri/Cargo.toml --example provider_probe -- --list\n\
         cargo run --manifest-path src-tauri/Cargo.toml --example provider_probe -- --account-id 2\n\
         \n\
         可选：--database <path> 显式指定 better-email.sqlite3"
    );
}
