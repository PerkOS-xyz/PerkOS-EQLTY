// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IERC1271Minimal {
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);
}
