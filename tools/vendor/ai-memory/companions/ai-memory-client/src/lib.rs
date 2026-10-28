//! Privacy validation and ingress sanitation shared by both capture companions.

use anyhow::{Result, bail};
use serde_json::Value;

mod scrub;
pub use scrub::sanitize_external_text;

/// Render a session id for terminal output, bounded so a long id cannot flood
/// a report. CodeQL's sensitive-data heuristic reads any `session_id` name as
/// account information; this is the function its `rust/cleartext-logging`
/// barrier model names for the companions
/// (`.github/codeql/extensions/ai-memory-models/models/log-barriers.model.yml`),
/// so companions print every session id through it. A session id is a routing
/// identifier, not a credential.
pub fn display_session_id(value: &str) -> String {
    const MAX_CHARS: usize = 64;
    let mut output = value.chars().take(MAX_CHARS).collect::<String>();
    if value.chars().count() > MAX_CHARS {
        output.push_str("...");
    }
    output
}

/// Reject credentials and control characters without changing retry identities.
pub fn reject_sensitive(value: &Value) -> Result<()> {
    bounded(value, 0)?;
    let mut safe = value.clone();
    sanitize_external_value(&mut safe)?;
    if safe != *value {
        bail!("sensitive envelope rejected before persistence or delivery");
    }
    Ok(())
}

/// Sanitize new payload values before persistence; callers validate identities first.
pub fn sanitize_external_value(value: &mut Value) -> Result<()> {
    bounded(value, 0)?;
    sanitize_value(value)
}

fn bounded(value: &Value, depth: usize) -> Result<()> {
    if depth > 64 {
        bail!("capture value exceeds nesting limit");
    }
    match value {
        Value::String(text) if text.len() > 256 * 1024 => bail!("capture text exceeds byte limit"),
        Value::Array(items) => items.iter().try_for_each(|item| bounded(item, depth + 1))?,
        Value::Object(fields) => {
            for (key, value) in fields {
                bounded(&Value::String(key.clone()), depth + 1)?;
                bounded(value, depth + 1)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn sanitize_value(value: &mut Value) -> Result<()> {
    match value {
        Value::String(text) => *text = sanitize_external_text(text),
        Value::Array(items) => items.iter_mut().try_for_each(sanitize_value)?,
        Value::Object(fields) => {
            for (key, value) in fields {
                reject_sensitive(&Value::String(key.clone()))?;
                if sensitive_key(key, value) {
                    *value = Value::String("[REDACTED]".into());
                } else {
                    sanitize_value(value)?;
                }
            }
        }
        _ => {}
    }
    Ok(())
}

fn sensitive_key(key: &str, value: &Value) -> bool {
    let chars: Vec<_> = key.chars().collect();
    let mut name = String::new();
    for (i, ch) in chars.iter().enumerate() {
        if ch.is_ascii_uppercase()
            && i > 0
            && (chars[i - 1].is_ascii_lowercase()
                || (chars[i - 1].is_ascii_uppercase()
                    && chars.get(i + 1).is_some_and(char::is_ascii_lowercase)))
        {
            name.push('_');
        }
        name.push(if ch.is_ascii_alphanumeric() {
            ch.to_ascii_lowercase()
        } else {
            '_'
        });
    }
    let metrics = concat!(
        "max_tokens input_tokens token_count token_usage ",
        "output_tokens total_tokens cache_read_input_tokens cache_creation_input_tokens ",
        "prompt_tokens completion_tokens reasoning_tokens"
    );
    let parts: Vec<_> = name.split('_').filter(|part| !part.is_empty()).collect();
    // Beyond the exact list, a `*_tokens` number is a usage count
    // (`cached_tokens`, `thinking_tokens`) unless a credential qualifier names
    // it (`access_tokens`, `refresh_tokens`); string values still redact.
    let usage_count = parts.len() > 1
        && parts.last() == Some(&"tokens")
        && !parts[..parts.len() - 1].iter().any(|part| {
            concat!(
                "access refresh id auth authorization bearer session api private ",
                "client oauth secret password credential cookie"
            )
            .split(' ')
            .any(|qualifier| qualifier == *part)
        });
    let is_metric = metrics.split(' ').any(|metric| metric == name) || usage_count;
    if value.is_number() && is_metric {
        return false;
    }
    let sensitive = concat!(
        "authorization auth jwt pwd bearer password passwd secret token cookie ",
        "credential apikey privatekey accesskey signature"
    );
    sensitive
        .split_ascii_whitespace()
        .any(|word| parts.iter().any(|part| part.trim_end_matches('s') == word))
        || parts.windows(2).any(|pair| {
            ["api", "private", "access", "session"].contains(&pair[0])
                && matches!(pair[1], "key" | "keys")
        })
}

/// Reject body-supplied authority and payloads requiring further sanitation.
pub fn check_body(body: &Value) -> Result<()> {
    if !body.is_object()
        || ["workspace", "project", "actor", "author_id", "headers"]
            .iter()
            .any(|key| body.get(key).is_some())
    {
        bail!("hook body cannot supply destination or actor authority");
    }
    reject_sensitive(body)?;
    if serde_json::to_vec(body)?.len() > 256 * 1024 {
        bail!("capture body exceeds byte limit");
    }
    Ok(())
}

#[cfg(test)]
#[path = "../tests/suite/mod.rs"]
mod tests;
