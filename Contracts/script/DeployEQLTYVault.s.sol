// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { EQLTYVault } from "../src/EQLTYVault.sol";

interface VmDeploy {
    function envAddress(string calldata name) external returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

contract DeployEQLTYVault {
    VmDeploy private constant VM =
        VmDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (EQLTYVault vault) {
        address riskSigner = VM.envAddress("RISK_SIGNER_ADDRESS");
        address tokenSpender = VM.envAddress("TOKEN_SPENDER_ADDRESS");

        VM.startBroadcast();
        vault = new EQLTYVault(riskSigner, tokenSpender);
        VM.stopBroadcast();
    }
}
