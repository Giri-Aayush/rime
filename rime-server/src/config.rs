//! Server configuration: the treasury group, signers, and tool locations.
//!
//! Loaded from a TOML file (default `runtime/rime-server.toml`, override with
//! RIME_SERVER_CONFIG). The file lives under runtime/ because it names local
//! paths and frost-client config files; see config.example.toml for the shape.

use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
pub struct SignerCfg {
    pub id: i64,
    pub name: String,
    /// frost-client communication pubkey (hex), as printed by keygen
    pub pubkey: String,
    /// Path to this signer's frost-client config (holds only their share)
    pub frost_config: String,
    /// Bearer token for the signer's UI/daemon
    pub token: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct RimeConfig {
    /// "main" or "test"
    pub network: String,
    /// zcash-devtool watch-only wallet directory
    pub wallet_dir: String,
    /// FROST group public key (hex)
    pub group: String,
    /// frostd URL, e.g. "localhost:2744"
    pub frostd_url: String,
    /// CA certificate that signs frostd's TLS cert (exported as SSL_CERT_FILE)
    pub ca_cert: String,
    /// Scratch directory for PCZT files
    pub runtime_dir: String,
    /// The treasury's Orchard-only unified address
    pub treasury_address: String,
    pub signers: Vec<SignerCfg>,
}

impl RimeConfig {
    pub fn load(path: &str) -> anyhow::Result<Self> {
        let raw = std::fs::read_to_string(path)?;
        Ok(toml::from_str(&raw)?)
    }

    pub fn signer_by_id(&self, id: i64) -> Option<&SignerCfg> {
        self.signers.iter().find(|s| s.id == id)
    }

    /// The ceremony coordinator: Signer #1 (the treasury operator).
    /// This is the ZIP 312 trust answer, stated openly in the threat model.
    pub fn coordinator(&self) -> &SignerCfg {
        &self.signers[0]
    }
}
