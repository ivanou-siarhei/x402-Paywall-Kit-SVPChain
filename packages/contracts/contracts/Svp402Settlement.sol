// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @title Svp402Settlement — pull-settlement for x402 on SVPChain (ERC-20 without EIP-3009, e.g. USDC).
/// @notice Payer signs EIP-712 PaymentAuthorization; anyone (facilitator) can submit.
///         Pulls funds via transferFrom, so payer must approve this contract first.
contract Svp402Settlement is EIP712 {
    using ECDSA for bytes32;

    struct PaymentAuthorization {
        address from;
        address to;
        address asset;
        uint256 amount;
        bytes32 nonce;
        uint64 validBefore;
        bytes32 resourceHash;
    }

    bytes32 private constant AUTH_TYPEHASH = keccak256(
        "PaymentAuthorization(address from,address to,address asset,uint256 amount,bytes32 nonce,uint64 validBefore,bytes32 resourceHash)"
    );

    /// @notice facilitator fee in basis points (10000 = 100%). 0 = disabled.
    uint256 public feeBps;
    address public feeRecipient;
    address public owner;

    mapping(address => mapping(bytes32 => bool)) private _used;

    event Settled(
        address indexed from,
        address indexed to,
        address asset,
        uint256 amount,
        bytes32 nonce,
        bytes32 resourceHash
    );
    event NonceCancelled(address indexed from, bytes32 indexed nonce);

    error Expired(uint64 validBefore, uint256 nowTs);
    error NonceUsed(address from, bytes32 nonce);
    error InvalidSignature(address expected, address recovered);
    error ZeroAmount();

    constructor(uint256 _feeBps, address _feeRecipient) EIP712("Svp402Settlement", "1") {
        owner = msg.sender;
        feeBps = _feeBps;
        feeRecipient = _feeRecipient;
    }

    function isNonceUsed(address from, bytes32 nonce) external view returns (bool) {
        return _used[from][nonce];
    }

    /// @notice Cancel your own nonce so it can never be settled.
    function cancelNonce(bytes32 nonce) external {
        _used[msg.sender][nonce] = true;
        emit NonceCancelled(msg.sender, nonce);
    }

    function settle(PaymentAuthorization calldata a, bytes calldata sig) external {
        _settle(a, sig);
    }

    function settleBatch(PaymentAuthorization[] calldata auths, bytes[] calldata sigs) external {
        require(auths.length == sigs.length, "length mismatch");
        for (uint256 i = 0; i < auths.length; i++) {
            _settle(auths[i], sigs[i]);
        }
    }

    function _settle(PaymentAuthorization calldata a, bytes calldata sig) internal {
        if (a.amount == 0) revert ZeroAmount();
        if (block.timestamp > a.validBefore) revert Expired(a.validBefore, block.timestamp);
        if (_used[a.from][a.nonce]) revert NonceUsed(a.from, a.nonce);

        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    AUTH_TYPEHASH,
                    a.from,
                    a.to,
                    a.asset,
                    a.amount,
                    a.nonce,
                    a.validBefore,
                    a.resourceHash
                )
            )
        );
        address recovered = digest.recover(sig);
        if (recovered != a.from) revert InvalidSignature(a.from, recovered);

        _used[a.from][a.nonce] = true;

        uint256 fee = (a.amount * feeBps) / 10000;
        if (fee > 0 && feeRecipient != address(0)) {
            IERC20(a.asset).transferFrom(a.from, feeRecipient, fee);
            IERC20(a.asset).transferFrom(a.from, a.to, a.amount - fee);
        } else {
            IERC20(a.asset).transferFrom(a.from, a.to, a.amount);
        }

        emit Settled(a.from, a.to, a.asset, a.amount, a.nonce, a.resourceHash);
    }
}
