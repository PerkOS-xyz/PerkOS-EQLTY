// @generated
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct Events {
    #[prost(uint64, tag = "1")]
    pub block_number: u64,
    #[prost(message, repeated, tag = "2")]
    pub events: ::prost::alloc::vec::Vec<Event>,
    #[prost(uint64, tag = "3")]
    pub block_timestamp_seconds: u64,
}

#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct Event {
    #[prost(string, tag = "1")]
    pub address: ::prost::alloc::string::String,
    #[prost(string, repeated, tag = "2")]
    pub topics: ::prost::alloc::vec::Vec<::prost::alloc::string::String>,
    #[prost(string, tag = "3")]
    pub transaction_hash: ::prost::alloc::string::String,
    #[prost(string, tag = "4")]
    pub data: ::prost::alloc::string::String,
    #[prost(string, tag = "5")]
    pub ticker: ::prost::alloc::string::String,
    #[prost(string, tag = "6")]
    pub pool_identifier: ::prost::alloc::string::String,
    #[prost(string, tag = "7")]
    pub protocol: ::prost::alloc::string::String,
}
