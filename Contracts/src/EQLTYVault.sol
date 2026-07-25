// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IERC1271Minimal } from "./interfaces/IERC1271Minimal.sol";
import { IERC20Minimal } from "./interfaces/IERC20Minimal.sol";
import { SignatureRecovery } from "./libraries/SignatureRecovery.sol";

/// @title EQLTY Vault
/// @notice Holds owner funds and permits only risk-signed strategy executions.
contract EQLTYVault is IERC1271Minimal {
    bytes4 private constant ERC1271_MAGIC_VALUE = 0x1626ba7e;
    bytes4 private constant ERC1271_INVALID = 0xffffffff;

    struct Strategy {
        address owner;
        address agent;
        address inputToken;
        address outputToken;
        address router;
        uint128 maxAmountPerTrade;
        uint128 maxTotalSpend;
        uint128 spent;
        uint64 expiresAt;
        uint16 maxSlippageBps;
        bool paused;
        bool revoked;
        bytes32 humanProofHash;
    }

    struct Execution {
        uint256 strategyId;
        uint256 amountIn;
        uint256 quotedAmountOut;
        uint256 minAmountOut;
        uint256 deadline;
        bytes32 signalHash;
        bytes32 quoteHash;
        bytes32 calldataHash;
        uint256 nonce;
    }

    bytes32 public constant EXECUTION_TYPEHASH = keccak256(
        "Execution(uint256 strategyId,uint256 amountIn,uint256 quotedAmountOut,uint256 minAmountOut,uint256 deadline,bytes32 signalHash,bytes32 quoteHash,bytes32 calldataHash,uint256 nonce)"
    );
    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant NAME_HASH = keccak256("EQLTY");
    bytes32 private constant VERSION_HASH = keccak256("1");

    address public immutable RISK_SIGNER;
    address public immutable TOKEN_SPENDER;
    uint256 public nextStrategyId = 1;

    uint256 private unlocked = 1;
    bool private permitValidationActive;

    mapping(uint256 strategyId => Strategy strategy) public strategies;
    mapping(uint256 strategyId => uint256 balance) public availableBalance;
    mapping(uint256 strategyId => uint256 nonce) public executionNonce;

    event StrategyCreated(
        uint256 indexed strategyId,
        address indexed owner,
        address indexed agent,
        address inputToken,
        address outputToken,
        address router,
        uint256 maxAmountPerTrade,
        uint256 maxTotalSpend,
        uint256 expiresAt,
        uint256 maxSlippageBps,
        bytes32 humanProofHash
    );
    event StrategyFunded(uint256 indexed strategyId, uint256 amount, uint256 available);
    event StrategyPaused(uint256 indexed strategyId, bool paused);
    event StrategyRevoked(uint256 indexed strategyId);
    event StrategyWithdrawal(uint256 indexed strategyId, uint256 amount);
    event TradeExecuted(
        uint256 indexed strategyId,
        uint256 indexed nonce,
        bytes32 indexed signalHash,
        bytes32 quoteHash,
        uint256 amountIn,
        uint256 amountOut,
        address router
    );

    error Unauthorized();
    error InvalidStrategy();
    error InvalidConfiguration();
    error StrategyInactive();
    error LimitExceeded();
    error InvalidExecution();
    error InvalidRiskSignature();
    error RouterCallFailed(bytes reason);
    error TokenOperationFailed();
    error Reentrancy();

    modifier nonReentrant() {
        _lock();
        _;
        _unlock();
    }

    function _lock() private {
        if (unlocked != 1) revert Reentrancy();
        unlocked = 2;
    }

    function _unlock() private {
        unlocked = 1;
    }

    constructor(address riskSigner_, address tokenSpender_) {
        if (riskSigner_ == address(0) || tokenSpender_ == address(0)) {
            revert InvalidConfiguration();
        }
        RISK_SIGNER = riskSigner_;
        TOKEN_SPENDER = tokenSpender_;
    }

    function createStrategy(
        address agent,
        address inputToken,
        address outputToken,
        address router,
        uint128 maxAmountPerTrade,
        uint128 maxTotalSpend,
        uint64 expiresAt,
        uint16 maxSlippageBps,
        bytes32 humanProofHash
    ) external returns (uint256 strategyId) {
        if (
            agent == address(0) || inputToken == address(0) || outputToken == address(0)
                || router == address(0) || inputToken == outputToken || maxAmountPerTrade == 0
                || maxTotalSpend < maxAmountPerTrade || expiresAt <= block.timestamp
                || maxSlippageBps > 2_000 || humanProofHash == bytes32(0)
        ) {
            revert InvalidConfiguration();
        }

        strategyId = nextStrategyId++;
        strategies[strategyId] = Strategy({
            owner: msg.sender,
            agent: agent,
            inputToken: inputToken,
            outputToken: outputToken,
            router: router,
            maxAmountPerTrade: maxAmountPerTrade,
            maxTotalSpend: maxTotalSpend,
            spent: 0,
            expiresAt: expiresAt,
            maxSlippageBps: maxSlippageBps,
            paused: false,
            revoked: false,
            humanProofHash: humanProofHash
        });

        emit StrategyCreated(
            strategyId,
            msg.sender,
            agent,
            inputToken,
            outputToken,
            router,
            maxAmountPerTrade,
            maxTotalSpend,
            expiresAt,
            maxSlippageBps,
            humanProofHash
        );
    }

    function fundStrategy(uint256 strategyId, uint256 amount) external nonReentrant {
        Strategy storage strategy = _strategy(strategyId);
        if (msg.sender != strategy.owner) revert Unauthorized();
        if (amount == 0) revert InvalidExecution();

        uint256 beforeBalance = IERC20Minimal(strategy.inputToken).balanceOf(address(this));
        _safeTransferFrom(strategy.inputToken, msg.sender, address(this), amount);
        uint256 afterBalance = IERC20Minimal(strategy.inputToken).balanceOf(address(this));
        if (afterBalance <= beforeBalance) revert TokenOperationFailed();

        uint256 received = afterBalance - beforeBalance;
        availableBalance[strategyId] += received;
        emit StrategyFunded(strategyId, received, availableBalance[strategyId]);
    }

    function setPaused(uint256 strategyId, bool paused) external {
        Strategy storage strategy = _strategy(strategyId);
        if (msg.sender != strategy.owner) revert Unauthorized();
        strategy.paused = paused;
        emit StrategyPaused(strategyId, paused);
    }

    function revoke(uint256 strategyId) external {
        Strategy storage strategy = _strategy(strategyId);
        if (msg.sender != strategy.owner) revert Unauthorized();
        strategy.revoked = true;
        emit StrategyRevoked(strategyId);
    }

    function withdraw(uint256 strategyId, uint256 amount) external nonReentrant {
        Strategy storage strategy = _strategy(strategyId);
        if (msg.sender != strategy.owner) revert Unauthorized();
        if (amount == 0 || amount > availableBalance[strategyId]) revert LimitExceeded();

        availableBalance[strategyId] -= amount;
        _safeTransfer(strategy.inputToken, strategy.owner, amount);
        emit StrategyWithdrawal(strategyId, amount);
    }

    function execute(
        Execution calldata execution,
        bytes calldata routerCalldata,
        bytes calldata signature
    ) external nonReentrant returns (uint256 amountOut) {
        Strategy storage strategy = _strategy(execution.strategyId);
        if (msg.sender != strategy.agent) revert Unauthorized();
        if (strategy.paused || strategy.revoked || block.timestamp > strategy.expiresAt) {
            revert StrategyInactive();
        }
        if (
            execution.deadline < block.timestamp || execution.amountIn == 0
                || execution.amountIn > strategy.maxAmountPerTrade
                || execution.amountIn > availableBalance[execution.strategyId]
                || uint256(strategy.spent) + execution.amountIn > strategy.maxTotalSpend
        ) {
            revert LimitExceeded();
        }
        if (
            execution.nonce != executionNonce[execution.strategyId]
                || execution.calldataHash != keccak256(routerCalldata)
                || execution.signalHash == bytes32(0) || execution.quoteHash == bytes32(0)
                || execution.quotedAmountOut == 0
                || execution.minAmountOut
                    < _slippageFloor(execution.quotedAmountOut, strategy.maxSlippageBps)
        ) {
            revert InvalidExecution();
        }
        if (SignatureRecovery.recover(_executionDigest(execution), signature) != RISK_SIGNER) {
            revert InvalidRiskSignature();
        }

        executionNonce[execution.strategyId]++;
        availableBalance[execution.strategyId] -= execution.amountIn;

        uint256 inputBefore = IERC20Minimal(strategy.inputToken).balanceOf(address(this));
        uint256 outputBefore = IERC20Minimal(strategy.outputToken).balanceOf(address(this));

        _forceApprove(strategy.inputToken, TOKEN_SPENDER, execution.amountIn);
        permitValidationActive = true;
        (bool success, bytes memory reason) = strategy.router.call(routerCalldata);
        permitValidationActive = false;
        _forceApprove(strategy.inputToken, TOKEN_SPENDER, 0);
        if (!success) revert RouterCallFailed(reason);

        uint256 inputAfter = IERC20Minimal(strategy.inputToken).balanceOf(address(this));
        uint256 outputAfter = IERC20Minimal(strategy.outputToken).balanceOf(address(this));
        if (inputAfter > inputBefore || outputAfter < outputBefore) revert InvalidExecution();

        uint256 amountSpent = inputBefore - inputAfter;
        amountOut = outputAfter - outputBefore;
        if (
            amountSpent == 0 || amountSpent > execution.amountIn
                || amountOut < execution.minAmountOut
        ) {
            revert InvalidExecution();
        }

        if (amountSpent < execution.amountIn) {
            availableBalance[execution.strategyId] += execution.amountIn - amountSpent;
        }
        // Safe because amountSpent cannot exceed the uint128 maxAmountPerTrade.
        // forge-lint: disable-next-line(unsafe-typecast)
        strategy.spent += uint128(amountSpent);
        _safeTransfer(strategy.outputToken, strategy.owner, amountOut);

        emit TradeExecuted(
            execution.strategyId,
            execution.nonce,
            execution.signalHash,
            execution.quoteHash,
            amountSpent,
            amountOut,
            strategy.router
        );
    }

    function executionDigest(Execution calldata execution) external view returns (bytes32) {
        return _executionDigest(execution);
    }

    function isValidSignature(bytes32 hash, bytes calldata signature)
        external
        view
        returns (bytes4)
    {
        if (!permitValidationActive) return ERC1271_INVALID;
        return SignatureRecovery.recover(hash, signature) == RISK_SIGNER
            ? ERC1271_MAGIC_VALUE
            : ERC1271_INVALID;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this))
        );
    }

    function _executionDigest(Execution calldata execution) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                EXECUTION_TYPEHASH,
                execution.strategyId,
                execution.amountIn,
                execution.quotedAmountOut,
                execution.minAmountOut,
                execution.deadline,
                execution.signalHash,
                execution.quoteHash,
                execution.calldataHash,
                execution.nonce
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function _strategy(uint256 strategyId) internal view returns (Strategy storage strategy) {
        strategy = strategies[strategyId];
        if (strategy.owner == address(0)) revert InvalidStrategy();
    }

    function _slippageFloor(uint256 quote, uint256 slippageBps) internal pure returns (uint256) {
        uint256 retainedBps = 10_000 - slippageBps;
        // This quotient/remainder form is exact and avoids quote * retainedBps overflow.
        // forge-lint: disable-next-line(divide-before-multiply)
        return (quote / 10_000) * retainedBps + (quote % 10_000) * retainedBps / 10_000;
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory data) =
            token.call(abi.encodeCall(IERC20Minimal.transfer, (to, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert TokenOperationFailed();
        }
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool ok, bytes memory data) =
            token.call(abi.encodeCall(IERC20Minimal.transferFrom, (from, to, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert TokenOperationFailed();
        }
    }

    function _forceApprove(address token, address spender, uint256 amount) internal {
        (bool ok, bytes memory data) =
            token.call(abi.encodeCall(IERC20Minimal.approve, (spender, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) {
            (ok,) = token.call(abi.encodeCall(IERC20Minimal.approve, (spender, 0)));
            if (!ok) revert TokenOperationFailed();
            (ok, data) = token.call(abi.encodeCall(IERC20Minimal.approve, (spender, amount)));
            if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) {
                revert TokenOperationFailed();
            }
        }
    }
}
