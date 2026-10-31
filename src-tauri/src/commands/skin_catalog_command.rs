use crate::error::{AppError, CommandError};
use regex::Regex;
use serde::Serialize;
use std::time::Duration;

const SKINDEX_ORIGIN: &str = "https://www.minecraftskins.com";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinCatalogEntry {
    pub id: String,
    pub name: String,
    pub author: Option<String>,
    pub preview_url: String,
    pub download_url: String,
    pub page_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinCatalogPage {
    pub skins: Vec<SkinCatalogEntry>,
    pub page: u32,
    pub has_more: bool,
}

fn decode_html_entities(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#039;", "'")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn join_site_url(path: &str) -> Option<String> {
    if path.starts_with("/uploads/preview-skins/") {
        Some(format!("{SKINDEX_ORIGIN}{path}"))
    } else if path.starts_with("https://www.minecraftskins.com/uploads/preview-skins/") {
        Some(path.to_string())
    } else {
        None
    }
}

fn parse_skin_cards(html: &str) -> Vec<SkinCatalogEntry> {
    let marker_re =
        Regex::new(r#"<div class="skin" data-role="skin-wrapper" data-id="(\d+)"[^>]*>"#)
            .expect("constant skin card marker regex is valid");
    let image_re = Regex::new(r#"<img[^>]*src="([^"]*preview-skins/[^"]+)"[^>]*alt="([^"]*)""#)
        .expect("constant skin image regex is valid");
    let author_re = Regex::new(r#"class="author-name">([^<]*)</span>"#)
        .expect("constant author regex is valid");
    let page_re = Regex::new(r#"href="(/skin/(\d+)/(?:[^\"]*)/)""#)
        .expect("constant skin page regex is valid");

    let markers: Vec<_> = marker_re.captures_iter(html).collect();
    let mut skins = Vec::new();

    for (index, marker) in markers.iter().enumerate() {
        let Some(marker_match) = marker.get(0) else {
            continue;
        };
        let Some(id_match) = marker.get(1) else {
            continue;
        };
        let start = marker_match.start();
        let end = markers
            .get(index + 1)
            .and_then(|next| next.get(0))
            .map(|next| next.start())
            .unwrap_or(html.len())
            .min(start.saturating_add(16_000));
        let card = &html[start..end];

        let Some(image) = image_re.captures(card) else {
            continue;
        };
        let Some(preview_path) = image.get(1).map(|capture| capture.as_str()) else {
            continue;
        };
        let Some(preview_url) = join_site_url(&decode_html_entities(preview_path)) else {
            continue;
        };

        let id = id_match.as_str().to_string();
        let name = image
            .get(2)
            .map(|capture| decode_html_entities(capture.as_str()).trim().to_string())
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| format!("Minecraft skin {id}"));
        let author = author_re
            .captures(card)
            .and_then(|capture| capture.get(1))
            .map(|capture| decode_html_entities(capture.as_str()).trim().to_string())
            .filter(|author| !author.is_empty());
        let page_path = page_re
            .captures(card)
            .filter(|capture| capture.get(2).is_some_and(|skin_id| skin_id.as_str() == id))
            .and_then(|capture| capture.get(1))
            .map(|capture| capture.as_str())
            .unwrap_or("");

        let download_url = preview_url.replace("/uploads/preview-skins/", "/uploads/skins/");

        skins.push(SkinCatalogEntry {
            id,
            name,
            author,
            preview_url,
            download_url,
            page_url: if page_path.is_empty() {
                SKINDEX_ORIGIN.to_string()
            } else {
                format!("{SKINDEX_ORIGIN}{page_path}")
            },
        });
    }

    skins
}

#[tauri::command]
pub async fn browse_skindex_skins(
    query: Option<String>,
    page: Option<u32>,
) -> Result<SkinCatalogPage, CommandError> {
    let page = page.unwrap_or(1).clamp(1, 100);
    let query = query
        .unwrap_or_default()
        .trim()
        .chars()
        .take(80)
        .collect::<String>();
    let route = if query.is_empty() {
        format!("/latest/{page}/")
    } else {
        let slug = query
            .split_whitespace()
            .collect::<Vec<_>>()
            .join("-")
            .to_lowercase();
        format!("/search/skin/{}/{page}/", urlencoding::encode(&slug))
    };
    let url = format!("{SKINDEX_ORIGIN}{route}");

    let client = reqwest::Client::builder()
        .user_agent("NoRiskClient Launcher/1.2.0 (+https://norisk.gg)")
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| AppError::Other(format!("Could not prepare Skin API request: {error}")))?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|error| AppError::Other(format!("Skin catalog request failed: {error}")))?;
    if !response.status().is_success() {
        return Err(
            AppError::Other(format!("Skin catalog returned HTTP {}", response.status())).into(),
        );
    }

    let html = response.text().await.map_err(|error| {
        AppError::Other(format!("Could not read skin catalog response: {error}"))
    })?;
    let next_route = if query.is_empty() {
        format!("/latest/{}/", page.saturating_add(1))
    } else {
        let slug = query
            .split_whitespace()
            .collect::<Vec<_>>()
            .join("-")
            .to_lowercase();
        format!(
            "/search/skin/{}/{}/",
            urlencoding::encode(&slug),
            page.saturating_add(1)
        )
    };
    let skins = parse_skin_cards(&html);
    let has_more = html.contains(&next_route) || skins.len() >= 12;

    Ok(SkinCatalogPage {
        skins,
        page,
        has_more,
    })
}

#[cfg(test)]
mod tests {
    use super::parse_skin_cards;

    #[test]
    fn parses_skindex_skin_cards_and_builds_full_download_url() {
        let html = r#"
            <div class="skin" data-role="skin-wrapper" data-id="42" data-preset="3">
              <div class="skin-img"><a href="/skin/42/blue-fox/"><img src="/uploads/preview-skins/2026/10/31/blue-fox-42.png?v974" width="155" alt="Blue &amp; Fox"/></a></div>
              <div class="skin-author"><span class="author-name">pixelmaker</span></div>
            </div>
        "#;

        let skins = parse_skin_cards(html);
        assert_eq!(skins.len(), 1);
        assert_eq!(skins[0].id, "42");
        assert_eq!(skins[0].name, "Blue & Fox");
        assert_eq!(skins[0].author.as_deref(), Some("pixelmaker"));
        assert_eq!(
            skins[0].download_url,
            "https://www.minecraftskins.com/uploads/skins/2026/10/31/blue-fox-42.png?v974"
        );
        assert_eq!(
            skins[0].page_url,
            "https://www.minecraftskins.com/skin/42/blue-fox/"
        );
    }
}
