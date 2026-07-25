// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { EQLTYVault } from "../src/EQLTYVault.sol";
import { MockERC20, VaultTestSupport } from "./support/VaultTestSupport.sol";

contract EQLTYVaultControlsTest is VaultTestSupport {
    function testRejectsInvalidConstructorConfiguration() public {
        vm.expectRevert(EQLTYVault.InvalidConfiguration.selector);
        new EQLTYVault(address(0), address(spender));

        vm.expectRevert(EQLTYVault.InvalidConfiguration.selector);
        new EQLTYVault(riskSigner, address(0));
    }

    function testRejectsInvalidStrategyConfiguration() public {
        vm.expectRevert(EQLTYVault.InvalidConfiguration.selector);
        vm.prank(owner);
        vault.createStrategy(
            address(0),
            address(inputToken),
            address(outputToken),
            address(router),
            MAX_TRADE,
            MAX_TOTAL,
            uint64(block.timestamp + 1 days),
            500,
            keccak256("proof")
        );

        vm.expectRevert(EQLTYVault.InvalidConfiguration.selector);
        vm.prank(owner);
        vault.createStrategy(
            agent,
            address(inputToken),
            address(inputToken),
            address(router),
            MAX_TRADE,
            MAX_TOTAL,
            uint64(block.timestamp + 1 days),
            500,
            keccak256("proof")
        );

        vm.expectRevert(EQLTYVault.InvalidConfiguration.selector);
        vm.prank(owner);
        vault.createStrategy(
            agent,
            address(inputToken),
            address(outputToken),
            address(router),
            MAX_TRADE,
            SMALL_TOTAL,
            uint64(block.timestamp + 1 days),
            500,
            keccak256("proof")
        );

        vm.expectRevert(EQLTYVault.InvalidConfiguration.selector);
        vm.prank(owner);
        vault.createStrategy(
            agent,
            address(inputToken),
            address(outputToken),
            address(router),
            MAX_TRADE,
            MAX_TOTAL,
            uint64(block.timestamp),
            500,
            keccak256("proof")
        );

        vm.expectRevert(EQLTYVault.InvalidConfiguration.selector);
        vm.prank(owner);
        vault.createStrategy(
            agent,
            address(inputToken),
            address(outputToken),
            address(router),
            MAX_TRADE,
            MAX_TOTAL,
            uint64(block.timestamp + 1 days),
            2_001,
            keccak256("proof")
        );
    }

    function testOnlyOwnerCanManageStrategy() public {
        vm.expectRevert(EQLTYVault.Unauthorized.selector);
        vm.prank(outsider);
        vault.setPaused(strategyId, true);

        vm.expectRevert(EQLTYVault.Unauthorized.selector);
        vm.prank(outsider);
        vault.revoke(strategyId);

        vm.expectRevert(EQLTYVault.Unauthorized.selector);
        vm.prank(outsider);
        vault.withdraw(strategyId, UNIT);

        inputToken.mint(outsider, UNIT);
        vm.prank(outsider);
        inputToken.approve(address(vault), UNIT);

        vm.expectRevert(EQLTYVault.Unauthorized.selector);
        vm.prank(outsider);
        vault.fundStrategy(strategyId, UNIT);
    }

    function testRejectsUnknownStrategyAndZeroFunding() public {
        vm.expectRevert(EQLTYVault.InvalidStrategy.selector);
        vault.setPaused(999, true);

        vm.expectRevert(EQLTYVault.InvalidExecution.selector);
        vm.prank(owner);
        vault.fundStrategy(strategyId, 0);
    }

    function testPauseAndRevokeBlockExecution() public {
        bytes memory routerCalldata = _swapCalldata(100 * UNIT, 2 ether);
        EQLTYVault.Execution memory execution = _execution(routerCalldata, 0);
        bytes memory signature = _signExecution(execution);

        vm.prank(owner);
        vault.setPaused(strategyId, true);

        vm.expectRevert(EQLTYVault.StrategyInactive.selector);
        vm.prank(agent);
        vault.execute(execution, routerCalldata, signature);

        vm.prank(owner);
        vault.setPaused(strategyId, false);
        vm.prank(owner);
        vault.revoke(strategyId);

        vm.expectRevert(EQLTYVault.StrategyInactive.selector);
        vm.prank(agent);
        vault.execute(execution, routerCalldata, signature);
    }

    function testExpiredStrategyBlocksExecution() public {
        bytes memory routerCalldata = _swapCalldata(100 * UNIT, 2 ether);
        EQLTYVault.Execution memory execution = _execution(routerCalldata, 0);
        bytes memory signature = _signExecution(execution);

        vm.warp(block.timestamp + 1 days + 1);

        vm.expectRevert(EQLTYVault.StrategyInactive.selector);
        vm.prank(agent);
        vault.execute(execution, routerCalldata, signature);
    }

    function testOwnerWithdrawsUnusedFunds() public {
        vm.prank(owner);
        vault.withdraw(strategyId, 125 * UNIT);

        _assertEq(vault.availableBalance(strategyId), 375 * UNIT);
        _assertEq(inputToken.balanceOf(owner), 125 * UNIT);

        vm.expectRevert(EQLTYVault.LimitExceeded.selector);
        vm.prank(owner);
        vault.withdraw(strategyId, 0);

        vm.expectRevert(EQLTYVault.LimitExceeded.selector);
        vm.prank(owner);
        vault.withdraw(strategyId, 376 * UNIT);
    }

    function testFeeTokenFundingCreditsActualAmount() public {
        MockERC20 feeToken = new MockERC20("Fee USDG", "fUSDG", 6, 100);
        feeToken.mint(owner, 100 * UNIT);
        vm.prank(owner);
        feeToken.approve(address(vault), type(uint256).max);

        vm.prank(owner);
        uint256 feeStrategyId = vault.createStrategy(
            agent,
            address(feeToken),
            address(outputToken),
            address(router),
            MAX_TRADE,
            MAX_TOTAL,
            uint64(block.timestamp + 1 days),
            500,
            keccak256("fee token owner")
        );

        vm.prank(owner);
        vault.fundStrategy(feeStrategyId, 100 * UNIT);

        _assertEq(vault.availableBalance(feeStrategyId), 99 * UNIT);
        _assertEq(feeToken.balanceOf(address(vault)), 99 * UNIT);
    }
}
