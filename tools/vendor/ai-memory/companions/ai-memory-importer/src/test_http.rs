//! Minimal HTTP/1.1 helpers for the hand-rolled test servers: read one
//! request, answer one JSON response and close the connection.

use std::io::{Read, Write};
use std::net::TcpStream;

pub(crate) fn read_http_request(stream: &mut TcpStream) -> (String, Vec<u8>) {
    let mut bytes = Vec::new();
    let mut buf = [0u8; 4096];
    let header_end = loop {
        let read = stream.read(&mut buf).unwrap();
        assert!(read > 0, "client closed before sending complete headers");
        bytes.extend_from_slice(&buf[..read]);
        if let Some(pos) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
            break pos + 4;
        }
    };
    let headers = String::from_utf8(bytes[..header_end].to_vec()).unwrap();
    let content_length = headers
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().unwrap())
        })
        .unwrap_or(0);
    while bytes.len() - header_end < content_length {
        let read = stream.read(&mut buf).unwrap();
        assert!(read > 0, "client closed before sending complete body");
        bytes.extend_from_slice(&buf[..read]);
    }
    (
        headers,
        bytes[header_end..header_end + content_length].to_vec(),
    )
}

pub(crate) fn respond_json(stream: &mut TcpStream, status: &str, body: &str) {
    write!(
        stream,
        "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    )
    .unwrap();
    stream.flush().unwrap();
}
