//! Literal directory labels and URL destinations for both OKF index writers.

use std::fmt::Write as _;

/// Render the already-ordered top-level directories of an OKF bundle.
///
/// Directory names are filesystem text, not Markdown or pre-encoded URLs.
/// Encoding each segment before adding the separator keeps literal percent
/// signs and fragment delimiters in the name when a reader follows the link.
#[must_use]
pub fn okf_directory_listing(families: &[String]) -> String {
    let mut listing = String::new();
    for family in families {
        let mut destination = String::new();
        for byte in family.bytes() {
            match byte {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                    destination.push(char::from(byte));
                }
                _ => {
                    let _ = write!(destination, "%{byte:02X}");
                }
            }
        }
        let mut label = String::new();
        let paired_underscores = family.matches('_').count() > 1;
        for character in family.chars() {
            if matches!(
                character,
                '\\' | '[' | ']' | '(' | ')' | '`' | '*' | '&' | '<' | '>' | '~'
            ) || (character == '_' && paired_underscores)
            {
                label.push('\\');
            }
            label.push(character);
        }
        let _ = writeln!(listing, "- [{label}/]({destination}/)");
    }
    listing
}
