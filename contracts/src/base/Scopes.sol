// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice App key permission bits. A key with POST only can't move funds or change follows.
library Scopes {
    uint32 internal constant POST = 1 << 0; // posts, replies, likes, reposts (offchain, checked by relays)
    uint32 internal constant FOLLOW = 1 << 1;
    uint32 internal constant COMMUNITY = 1 << 2;
    uint32 internal constant FEED = 1 << 3;
    uint32 internal constant CHAT = 1 << 4;
    uint32 internal constant PAY = 1 << 5;
    uint32 internal constant ANCHOR = 1 << 6; // escape hatch submissions
    uint32 internal constant FULL = type(uint32).max;
}

/// @notice Key types. Only SECP256K1 keys can send transactions; the rest are stored for offchain verifiers.
library KeyTypes {
    uint8 internal constant SECP256K1 = 1; // key = 20-byte address
    uint8 internal constant ED25519 = 2;
    uint8 internal constant P256 = 3;
    uint8 internal constant X25519 = 4; // chat encryption (MLS / XMTP)
}
