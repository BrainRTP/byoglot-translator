use crate::{ProviderPreset, contracts};
use serde_json::{Map, Value, json};
use std::net::{Ipv4Addr, Ipv6Addr};

pub fn effort_variants(
    preset: ProviderPreset,
    supported_levels: Option<&[String]>,
    supported_parameters: Option<&[String]>,
) -> Vec<String> {
    let mut variants = vec!["none".into()];
    if preset == ProviderPreset::Deepseek {
        variants.extend_from_slice(supported_levels.unwrap_or_default());
    }
    if preset == ProviderPreset::Openrouter
        && supported_parameters.is_some_and(|p| p.iter().any(|v| v == "reasoning"))
    {
        variants.extend(["low".into(), "medium".into(), "high".into()]);
    }
    variants
}
pub fn effort_params(preset: ProviderPreset, variant: Option<&str>) -> Map<String, Value> {
    match preset {
        ProviderPreset::Deepseek => json!({"reasoning_effort": variant.unwrap_or("none")})
            .as_object()
            .unwrap()
            .clone(),
        ProviderPreset::Openrouter if variant.is_some_and(|v| v != "none") => {
            json!({"reasoning": {"effort": variant.unwrap()}})
                .as_object()
                .unwrap()
                .clone()
        }
        _ => Map::new(),
    }
}
pub fn needs_key(preset: ProviderPreset, base_url: &str) -> bool {
    if preset == ProviderPreset::Custom
        && endpoint(base_url).is_some_and(|url| url.host == "localhost" || url.host == "127.0.0.1")
    {
        return false;
    }
    contracts::presets()[&preset].needs_key
}

pub(crate) struct Endpoint {
    pub origin: String,
    pub host: String,
    pub secure: bool,
}
pub(crate) fn endpoint(url: &str) -> Option<Endpoint> {
    if url
        .chars()
        .any(|c| c.is_whitespace() || c.is_control() || c == '\\')
    {
        return None;
    }
    let (scheme, rest) = url.split_once("://")?;
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return None;
    }
    let authority = rest.split(['/', '?', '#']).next()?;
    if authority.is_empty() || authority.contains('@') {
        return None;
    }
    let (host, port) = if let Some(ip) = authority.strip_prefix('[') {
        let (ip, tail) = ip.split_once(']')?;
        let ip = ip.parse::<Ipv6Addr>().ok()?;
        (
            format!("[{ip}]"),
            if tail.is_empty() {
                None
            } else {
                Some(tail.strip_prefix(':')?)
            },
        )
    } else {
        let (host, port) = authority
            .split_once(':')
            .map_or((authority, None), |(h, p)| (h, Some(p)));
        if host.len() > 253
            || host.is_empty()
            || !host.trim_end_matches('.').split('.').all(|label| {
                !label.is_empty()
                    && label.len() <= 63
                    && !label.starts_with('-')
                    && !label.ends_with('-')
                    && label
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'-')
            })
        {
            return None;
        }
        (host.to_ascii_lowercase(), port)
    };
    let port = match port {
        Some(port) if !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit()) => {
            Some(port.parse::<u16>().ok()?)
        }
        Some(_) => return None,
        None => None,
    };
    let suffix = match port {
        Some(80) if scheme == "http" => String::new(),
        Some(443) if scheme == "https" => String::new(),
        Some(p) => format!(":{p}"),
        None => String::new(),
    };
    Some(Endpoint {
        origin: format!("{scheme}://{host}{suffix}"),
        host,
        secure: scheme == "https",
    })
}
pub(crate) fn permitted_endpoint(url: &str) -> Option<Endpoint> {
    endpoint(url).filter(|url| url.secure || is_local_host(&url.host))
}
pub fn origin_of(base_url: &str) -> Option<String> {
    endpoint(base_url).map(|url| url.origin)
}
pub(crate) fn local_origin(url: &str) -> bool {
    endpoint(url).is_some_and(|url| is_local_host(&url.host))
}
pub fn is_local_host(host: &str) -> bool {
    let host = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".local") {
        return true;
    }
    if let Ok(ip) = host.parse::<Ipv6Addr>() {
        let first = ip.segments()[0];
        return ip == Ipv6Addr::LOCALHOST || first & 0xfe00 == 0xfc00 || first & 0xffc0 == 0xfe80;
    }
    if let Ok(ip) = host.parse::<Ipv4Addr>() {
        let [a, b, _, _] = ip.octets();
        return a == 127
            || a == 10
            || (a == 172 && (16..=31).contains(&b))
            || (a == 192 && b == 168)
            || (a == 169 && b == 254);
    }
    false
}
