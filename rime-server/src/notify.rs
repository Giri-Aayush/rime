//! Discord notifications.
//!
//! Treasury activity — a payment reaching quorum, a broadcast landing on
//! chain, a signer recovered — pings the team's own Discord channel. The
//! approval flow lives where the people who approve already are. Fire and
//! forget: a webhook failure never affects the treasury operation.

/// Resolve the webhook URL: env override wins over the config value.
pub fn resolve(config_value: &Option<String>) -> Option<String> {
    std::env::var("RIME_DISCORD_WEBHOOK")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| config_value.clone())
}

/// Post a message to a Discord webhook. Best-effort; logs and swallows errors.
pub fn ping(webhook: Option<String>, content: String) {
    let Some(url) = webhook else { return };
    tokio::spawn(async move {
        let client = reqwest::Client::new();
        let res = client
            .post(&url)
            .json(&serde_json::json!({ "content": content }))
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await;
        if let Err(e) = res {
            tracing::warn!("discord webhook failed: {e}");
        }
    });
}
