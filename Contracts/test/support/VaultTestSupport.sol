// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { EQLTYVault } from "../../src/EQLTYVault.sol";
import { IERC1271Minimal } from "../../src/interfaces/IERC1271Minimal.sol";
import { IERC20Minimal } from "../../src/interfaces/IERC20Minimal.sol";

interface Vm {
    function addr(uint256 signingFixture) external returns (address);
    function expectPartialRevert(bytes4 selector) external;
    function expectRevert(bytes4 selector) external;
    function prank(address sender) external;
    function sign(uint256 signingFixture, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
}

contract MockERC20 is IERC20Minimal {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint16 public feeBps;

    mapping(address account => uint256 balance) public balances;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowances;

    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint16 feeBps_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
        feeBps = feeBps_;
    }

    function balanceOf(address account) external view returns (uint256) {
        return balances[account];
    }

    function allowance(address owner, address spender) external view returns (uint256) {
        return allowances[owner][spender];
    }

    function mint(address account, uint256 amount) external {
        balances[account] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowances[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowances[from][msg.sender];
        require(allowed >= amount, "ALLOWANCE");
        if (allowed != type(uint256).max) {
            allowances[from][msg.sender] = allowed - amount;
        }
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        require(balances[from] >= amount, "BALANCE");
        balances[from] -= amount;
        uint256 fee = amount * feeBps / 10_000;
        balances[to] += amount - fee;
    }
}

contract MockTokenSpender {
    function pull(address token, address from, address to, uint256 amount) external {
        require(IERC20Minimal(token).transferFrom(from, to, amount), "PULL");
    }
}

contract MockRouter {
    bytes4 private constant ERC1271_MAGIC_VALUE = 0x1626ba7e;

    MockTokenSpender public spender;

    constructor(MockTokenSpender spender_) {
        spender = spender_;
    }

    function swap(
        address inputToken,
        address outputToken,
        uint256 amountIn,
        uint256 amountOut,
        bytes32 permitHash,
        bytes calldata permitSignature
    ) external {
        require(
            IERC1271Minimal(msg.sender).isValidSignature(permitHash, permitSignature)
                == ERC1271_MAGIC_VALUE,
            "PERMIT"
        );
        spender.pull(inputToken, msg.sender, address(this), amountIn);
        MockERC20(outputToken).mint(msg.sender, amountOut);
    }

    function swapTo(
        address inputToken,
        address outputToken,
        address recipient,
        uint256 amountIn,
        uint256 amountOut,
        bytes32 permitHash,
        bytes calldata permitSignature
    ) external {
        require(
            IERC1271Minimal(msg.sender).isValidSignature(permitHash, permitSignature)
            == ERC1271_MAGIC_VALUE,
            "PERMIT"
        );
        spender.pull(inputToken, msg.sender, address(this), amountIn);
        MockERC20(outputToken).mint(recipient, amountOut);
    }

    function fail() external pure {
        revert("ROUTER");
    }
}

abstract contract VaultTestSupport {
    // Forge exposes its test cheatcodes at this conventional address.
    // forge-lint: disable-next-line(screaming-snake-case-const)
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant RISK_SIGNING_FIXTURE = uint256(keccak256("EQLTY_TEST_RISK_SIGNER"));
    uint256 internal constant UNIT = 1e6;
    uint128 internal constant MAX_TRADE = 100_000_000;
    uint128 internal constant MAX_TOTAL = 500_000_000;
    uint128 internal constant SMALL_TOTAL = 50_000_000;
    uint128 internal constant LIMITED_TOTAL = 150_000_000;

    address internal owner = address(0xA11CE);
    address internal agent = address(0xA63E7);
    address internal outsider = address(0xB0B);
    address internal riskSigner;

    MockERC20 internal inputToken;
    MockERC20 internal outputToken;
    MockTokenSpender internal spender;
    MockRouter internal router;
    EQLTYVault internal vault;
    uint256 internal strategyId;

    function setUp() public virtual {
        riskSigner = vm.addr(RISK_SIGNING_FIXTURE);
        inputToken = new MockERC20("Test USDG", "USDG", 6, 0);
        outputToken = new MockERC20("Test Equity", "EQL", 18, 0);
        spender = new MockTokenSpender();
        router = new MockRouter(spender);
        vault = new EQLTYVault(riskSigner, address(spender));

        inputToken.mint(owner, 500 * UNIT);
        vm.prank(owner);
        inputToken.approve(address(vault), type(uint256).max);

        vm.prank(owner);
        strategyId = vault.createStrategy(
            agent,
            address(inputToken),
            address(outputToken),
            address(router),
            MAX_TRADE,
            MAX_TOTAL,
            uint64(block.timestamp + 1 days),
            500,
            keccak256("verified owner")
        );

        vm.prank(owner);
        vault.fundStrategy(strategyId, 500 * UNIT);
    }

    function _execution(bytes memory routerCalldata, uint256 nonce)
        internal
        view
        returns (EQLTYVault.Execution memory execution)
    {
        execution = EQLTYVault.Execution({
            strategyId: strategyId,
            amountIn: 100 * UNIT,
            quotedAmountOut: 2 ether,
            minAmountOut: 1.9 ether,
            deadline: block.timestamp + 5 minutes,
            signalHash: keccak256("signal"),
            quoteHash: keccak256("quote"),
            calldataHash: keccak256(routerCalldata),
            nonce: nonce
        });
    }

    function _swapCalldata(uint256 amountIn, uint256 amountOut) internal returns (bytes memory) {
        bytes32 permitHash = keccak256(abi.encode(strategyId, amountIn, amountOut));
        bytes memory permitSignature = _sign(permitHash);
        return abi.encodeCall(
            MockRouter.swap,
            (
                address(inputToken),
                address(outputToken),
                amountIn,
                amountOut,
                permitHash,
                permitSignature
            )
        );
    }

    function _signExecution(EQLTYVault.Execution memory execution) internal returns (bytes memory) {
        return _sign(vault.executionDigest(execution));
    }

    function _sign(bytes32 digest) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(RISK_SIGNING_FIXTURE, digest);
        return abi.encodePacked(r, s, v);
    }

    function _assertEq(uint256 actual, uint256 expected) internal pure {
        require(actual == expected, "UINT_NOT_EQUAL");
    }

    function _assertEq(bytes4 actual, bytes4 expected) internal pure {
        require(actual == expected, "BYTES4_NOT_EQUAL");
    }
}
