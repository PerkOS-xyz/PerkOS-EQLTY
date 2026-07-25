#![allow(clippy::not_unsafe_ptr_arg_deref)]

mod pb;

use anyhow::anyhow;
use pb::eqlty::graph::v1::{Event, Events};
use substreams::{errors::Error, Hex};
use substreams_ethereum::pb::eth::v2::Block;

substreams_ethereum::init!();

#[substreams::handlers::map]
fn map_pool_events(pool_params: String, block: Block) -> Result<Events, Error> {
    let selectors = PoolSelectors::parse(&pool_params)?;
    let events = block
        .logs()
        .filter_map(|log| {
            let matched = selectors.find(log.address(), log.topics())?;
            Some(Event {
                address: format!("0x{}", Hex::encode(log.address())),
                topics: log
                    .topics()
                    .iter()
                    .map(|topic| format!("0x{}", Hex::encode(topic)))
                    .collect(),
                transaction_hash: format!("0x{}", Hex::encode(&log.receipt.transaction.hash)),
                data: format!("0x{}", Hex::encode(log.data())),
                ticker: matched.ticker,
                pool_identifier: matched.pool_identifier,
                protocol: matched.protocol,
            })
        })
        .collect();

    Ok(Events {
        block_number: block.number,
        block_timestamp_seconds: block.timestamp_seconds(),
        events,
    })
}

struct PoolSelectors {
    v3_addresses: Vec<Vec<u8>>,
    v4_manager: Vec<u8>,
    v4_pools: Vec<PoolSelector>,
}

#[derive(Clone)]
struct PoolSelector {
    id: Vec<u8>,
    ticker: String,
}

struct PoolMatch {
    ticker: String,
    pool_identifier: String,
    protocol: String,
}

impl PoolSelectors {
    fn parse(params: &str) -> Result<Self, Error> {
        let (v3_part, v4_part) = params
            .split_once(";v4=")
            .ok_or_else(|| anyhow!("expected v3=<addresses>;v4=<manager>:<pool ids>"))?;
        let v3_addresses = decode_list(
            v3_part
                .strip_prefix("v3=")
                .ok_or_else(|| anyhow!("missing v3 selector"))?,
            20,
        )?;
        let (manager, ids) = v4_part
            .split_once(':')
            .ok_or_else(|| anyhow!("missing v4 pool ids"))?;
        let v4_manager = decode_hex(manager, 20)?;
        let v4_pools = decode_v4_pools(ids)?;
        if v4_pools.is_empty() {
            return Err(anyhow!("at least one v4 pool is required"));
        }
        Ok(Self {
            v3_addresses,
            v4_manager,
            v4_pools,
        })
    }

    fn find(&self, address: &[u8], topics: &[Vec<u8>]) -> Option<PoolMatch> {
        if let Some(candidate) = self
            .v3_addresses
            .iter()
            .find(|candidate| candidate.as_slice() == address)
        {
            return Some(PoolMatch {
                ticker: String::new(),
                pool_identifier: format!("0x{}", Hex::encode(candidate)),
                protocol: "v3".to_string(),
            });
        }
        if address != self.v4_manager.as_slice() {
            return None;
        }
        let pool_id = topics.get(1)?;
        let candidate = self
            .v4_pools
            .iter()
            .find(|candidate| candidate.id.as_slice() == pool_id.as_slice())?;
        Some(PoolMatch {
            ticker: candidate.ticker.clone(),
            pool_identifier: format!("0x{}", Hex::encode(pool_id)),
            protocol: "v4".to_string(),
        })
    }
}

fn decode_v4_pools(value: &str) -> Result<Vec<PoolSelector>, Error> {
    value
        .split(',')
        .filter(|entry| !entry.is_empty())
        .map(|entry| {
            let (id, ticker) = entry
                .split_once('=')
                .ok_or_else(|| anyhow!("v4 selector must be <pool id>=<ticker>"))?;
            let normalized_ticker = ticker.trim().to_ascii_uppercase();
            if normalized_ticker.is_empty()
                || !normalized_ticker
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric())
            {
                return Err(anyhow!("ticker is invalid"));
            }
            Ok(PoolSelector {
                id: decode_hex(id, 32)?,
                ticker: normalized_ticker,
            })
        })
        .collect()
}

fn decode_list(value: &str, expected_bytes: usize) -> Result<Vec<Vec<u8>>, Error> {
    value
        .split(',')
        .filter(|entry| !entry.is_empty())
        .map(|entry| decode_hex(entry, expected_bytes))
        .collect()
}

fn decode_hex(value: &str, expected_bytes: usize) -> Result<Vec<u8>, Error> {
    let normalized = value.trim().trim_start_matches("0x");
    if normalized.len() != expected_bytes * 2
        || !normalized
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err(anyhow!("selector is not valid hex"));
    }
    Ok(Hex::decode(normalized)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ticker_bound_v4_pool() {
        let pool = format!("0x{}=nvda", "11".repeat(32));
        let selectors =
            PoolSelectors::parse(&format!("v3=;v4=0x{}:{}", "22".repeat(20), pool)).unwrap();
        assert_eq!(selectors.v4_pools.len(), 1);
        assert_eq!(selectors.v4_pools[0].ticker, "NVDA");
    }

    #[test]
    fn rejects_unbound_v4_pool() {
        let params = format!("v3=;v4=0x{}:0x{}", "22".repeat(20), "11".repeat(32));
        assert!(PoolSelectors::parse(&params).is_err());
    }
}
