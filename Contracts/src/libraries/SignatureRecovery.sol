// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

library SignatureRecovery {
    uint256 private constant MAX_S =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    function recover(bytes32 digest, bytes calldata signature)
        internal
        pure
        returns (address signer)
    {
        if (signature.length != 65) return address(0);

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        if (v < 27) v += 27;
        if ((v != 27 && v != 28) || uint256(s) > MAX_S) {
            return address(0);
        }
        return ecrecover(digest, v, r, s);
    }
}
