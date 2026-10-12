use super::tests::{
    initialize_response, mcp_input, read_request, spawn_mcp_test_server, tool_list_response,
};
use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;

#[test]
fn the_request_deadline_is_shared_across_handshake_and_pagination() {
    let mut client = McpClient::new("http://127.0.0.1:9/mcp", "", 5).unwrap();
    client.deadline = std::time::Instant::now() - Duration::from_secs(1);
    assert!(client
        .call("tools/list", serde_json::json!({}))
        .unwrap_err()
        .contains("已超时"));
}

#[test]
fn sse_returns_without_reading_past_the_matching_event() {
    struct OpenStream(std::io::Cursor<Vec<u8>>);
    impl Read for OpenStream {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            if self.0.position() == self.0.get_ref().len() as u64 {
                panic!("client waited for SSE EOF after receiving its response");
            }
            // Exercise fragmented UTF-8 and split CRLF boundaries.
            self.0.read(&mut buffer[..1])
        }
    }
    for newline in ["\n", "\r\n", "\r"] {
        let body = [
            "\u{feff}: keepalive",
            "",
            "data: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\"}",
            "",
            "data: {\"jsonrpc\":\"2.0\",\"id\":99,\"result\":{}}",
            "",
            "data: {\"jsonrpc\":\"2.0\",\"id\":3,",
            "data: \"result\":{\"text\":\"中文\"}}",
            "",
            "",
        ]
        .join(newline);
        let result = read_sse_rpc(OpenStream(std::io::Cursor::new(body.into_bytes())), 3).unwrap();
        assert_eq!(result["result"]["text"], "中文");
    }
}

#[test]
fn sse_rejects_oversized_comments_and_incomplete_or_wrong_responses() {
    let large = format!(":{}", "x".repeat(MAX_AI_RESPONSE_BYTES as usize));
    assert!(read_sse_rpc(large.as_bytes(), 1)
        .unwrap_err()
        .contains("大小上限"));
    let incomplete = b"data: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n";
    assert!(read_sse_rpc(&incomplete[..], 1)
        .unwrap_err()
        .contains("完整响应"));
    let wrong = b"data: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{}}\n\n";
    assert!(read_sse_rpc(&wrong[..], 1)
        .unwrap_err()
        .contains("id 不匹配"));
}

#[test]
fn rpc_validates_envelopes_and_preserves_sse_error_details() {
    for payload in [
        serde_json::json!({ "id": 1, "result": {} }),
        serde_json::json!({ "jsonrpc": "2.0", "id": 1 }),
        serde_json::json!({ "jsonrpc": "2.0", "id": 1, "result": {}, "error": {} }),
        serde_json::json!({ "jsonrpc": "2.0", "id": 1, "result": null }),
        serde_json::json!({ "jsonrpc": "2.0", "id": "1", "result": {} }),
    ] {
        assert!(validate_rpc_response(payload, 1).is_err());
    }
    let body = "data: {\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32602,\"message\":\"invalid language\"}}\n\n";
    let payload = read_sse_rpc(body.as_bytes(), 1).unwrap();
    assert!(validate_rpc_response(payload, 1)
        .unwrap_err()
        .contains("invalid language"));
}

#[test]
fn initialization_rejects_unsupported_versions_and_missing_capabilities() {
    for response in [
        initialize_response("2099-01-01"),
        (
            200,
            vec![("Content-Type", "application/json")],
            serde_json::json!({
                "jsonrpc": "2.0", "id": 1,
                "result": { "protocolVersion": MCP_PROTOCOL_VERSION, "capabilities": {} }
            })
            .to_string(),
        ),
        (
            200,
            vec![("Content-Type", "application/json")],
            serde_json::json!({
                "jsonrpc": "2.0", "id": 1, "result": { "capabilities": { "tools": {} } }
            })
            .to_string(),
        ),
    ] {
        let (endpoint, server) = spawn_mcp_test_server(vec![response]);
        assert!(run_mcp_tool_call(&mcp_input(&endpoint, "translate")).is_err());
        assert_eq!(
            server.join().unwrap().len(),
            1,
            "no initialized notification after invalid handshake"
        );
    }
}

#[test]
fn connection_test_discovers_tools_without_sending_mail() {
    let (endpoint, server) = spawn_mcp_test_server(vec![
        initialize_response(MCP_PROTOCOL_VERSION),
        (202, vec![], String::new()),
        tool_list_response(2, &["translate", "summarize", "generate_template"]),
    ]);
    let result = test_ai_connection("mcp", &endpoint, "", "", 5).unwrap();
    assert!(result.message.contains("翻译、摘要、模板"));
    let requests = server.join().unwrap();
    assert_eq!(requests.len(), 3);
    assert_eq!(requests[2].1["method"], "tools/list");
    assert!(requests
        .iter()
        .all(|request| !request.0.contains("authorization:")));
    assert!(requests
        .iter()
        .all(|request| !request.1.to_string().contains("hello")));
}

#[test]
fn unsupported_tools_fail_before_any_mail_is_sent() {
    let (endpoint, server) = spawn_mcp_test_server(vec![
        initialize_response(MCP_PROTOCOL_VERSION),
        (202, vec![], String::new()),
        tool_list_response(2, &["send_mail"]),
    ]);
    let error = run_mcp_tool_call(&mcp_input(&endpoint, "translate")).unwrap_err();
    assert!(error.contains("未提供"));
    assert_eq!(server.join().unwrap().len(), 3);
}

#[test]
fn tool_runtime_errors_do_not_retry_another_alias() {
    let (endpoint, server) = spawn_mcp_test_server(vec![
        initialize_response(MCP_PROTOCOL_VERSION),
        (202, vec![], String::new()),
        tool_list_response(2, &["translate_message", "translate"]),
        (
            200,
            vec![("Content-Type", "text/event-stream")],
            format!(
                "data: {}\n\n",
                serde_json::json!({
                    "jsonrpc": "2.0", "id": 3,
                    "result": { "isError": true, "content": [{ "type": "text", "text": "quota exhausted" }] }
                })
            ),
        ),
    ]);
    let error = run_mcp_tool_call(&mcp_input(&endpoint, "translate")).unwrap_err();
    assert!(error.contains("quota exhausted"));
    assert_eq!(server.join().unwrap().len(), 4);
}

#[test]
fn tool_discovery_paginates_and_rejects_repeated_cursors() {
    let mut page = tool_list_response(2, &["unrelated"]);
    let mut body: serde_json::Value = serde_json::from_str(&page.2).unwrap();
    body["result"]["nextCursor"] = serde_json::json!("next");
    page.2 = body.to_string();
    let (endpoint, server) = spawn_mcp_test_server(vec![
        initialize_response(MCP_PROTOCOL_VERSION),
        (202, vec![], String::new()),
        page.clone(),
        tool_list_response(3, &["translate"]),
    ]);
    assert!(test_ai_connection("mcp", &endpoint, "", "", 5).unwrap().ok);
    assert_eq!(server.join().unwrap()[3].1["params"]["cursor"], "next");
    body["id"] = serde_json::json!(3);
    let repeated = (
        200,
        vec![("Content-Type", "application/json")],
        body.to_string(),
    );
    let (endpoint, server) = spawn_mcp_test_server(vec![
        initialize_response(MCP_PROTOCOL_VERSION),
        (202, vec![], String::new()),
        page,
        repeated,
    ]);
    assert!(test_ai_connection("mcp", &endpoint, "", "", 5)
        .unwrap_err()
        .contains("游标重复"));
    assert_eq!(server.join().unwrap().len(), 4);
}

#[test]
fn text_results_reject_blank_and_binary_content() {
    assert!(mcp_result_content(
        &serde_json::json!({"content": [{"type":"image", "data":"base64"}]})
    )
    .is_none());
    assert!(
        mcp_result_content(&serde_json::json!({"content": [{"type":"text", "text":"  "}]}))
            .is_none()
    );
    assert_eq!(
        mcp_result_content(&serde_json::json!({"structuredContent": {"summary":"摘要"}})).unwrap(),
        "摘要"
    );
    assert_eq!(
        mcp_result_content(
            &serde_json::json!({"content": [{"type":"resource", "resource":{"text":"正文"}}]})
        )
        .unwrap(),
        "正文"
    );
}

#[test]
fn incompatible_required_arguments_are_rejected() {
    let tool = serde_json::json!({"inputSchema": {"type":"object", "required":["recipient"]}});
    assert!(
        validate_tool_arguments(&tool, &serde_json::json!({"text":"mail"}))
            .unwrap_err()
            .contains("recipient")
    );
}

#[test]
fn connection_test_rejects_incompatible_tool_parameters_without_calling_them() {
    let mut page = tool_list_response(2, &["translate"]);
    let mut body: serde_json::Value = serde_json::from_str(&page.2).unwrap();
    body["result"]["tools"][0]["inputSchema"]["required"] = serde_json::json!(["recipient"]);
    page.2 = body.to_string();
    let (endpoint, server) = spawn_mcp_test_server(vec![
        initialize_response(MCP_PROTOCOL_VERSION),
        (202, vec![], String::new()),
        page,
    ]);
    assert!(test_ai_connection("mcp", &endpoint, "", "", 5)
        .unwrap_err()
        .contains("参数兼容"));
    assert_eq!(server.join().unwrap().len(), 3);
}

#[test]
fn mcp_preserves_trailing_slash_in_the_request_target() {
    let (endpoint, server) = spawn_mcp_test_server(vec![initialize_response("2099-01-01")]);
    let _ = run_mcp_tool_call(&mcp_input(&format!("{endpoint}/"), "translate"));
    assert!(server.join().unwrap()[0]
        .0
        .starts_with("post /mcp/ http/1.1"));
}

#[test]
fn persistent_http_sse_returns_before_the_server_closes_the_stream() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/mcp", listener.local_addr().unwrap());
    let (done_tx, done_rx) = std::sync::mpsc::channel();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        read_request(&mut stream);
        let body = format!(
            "data: {}\r\n\r\n",
            serde_json::json!({
                "jsonrpc":"2.0", "id":1, "result": {"protocolVersion":"2099-01-01"}
            })
        );
        stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n").unwrap();
        write!(stream, "{:x}\r\n{}\r\n", body.len(), body).unwrap();
        stream.flush().unwrap();
        // Server deliberately does not send the terminating HTTP chunk.
        done_rx.recv_timeout(Duration::from_secs(2)).is_ok()
    });
    let error = run_mcp_tool_call(&mcp_input(&endpoint, "translate")).unwrap_err();
    done_tx.send(()).unwrap();
    assert!(server.join().unwrap(), "client waited for stream closure");
    assert!(error.contains("协议版本"), "actual error: {error}");
}
