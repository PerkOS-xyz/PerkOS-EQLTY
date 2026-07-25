// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { EQLTYVault } from "../src/EQLTYVault.sol";
import { VaultTestSupport } from "./support/VaultTestSupport.sol";

contract EQLTYVaultLimitsTest is VaultTestSupport {
    function testRejectsPerTradeLimit() public {
        bytes memory routerCalldata = _swapCalldata(101 * UNIT, 2 ether);
        EQLTYVault.Execution memory execution = _execution(routerCalldata, 0);
        execution.amountIn = 101 * UNIT;

        vm.expectRevert(EQLTYVault.LimitExceeded.selector);
        vm.prank(agent);
        vault.execute(execution, routerCalldata, "");
    }

    function testRejectsExpiredExecutionDeadline() public {
        bytes memory routerCalldata = _swapCalldata(100 * UNIT, 2 ether);
        EQLTYVault.Execution memory execution = _execution(routerCalldata, 0);
        execution.deadline = block.timestamp - 1;

        vm.expectRevert(EQLTYVault.LimitExceeded.selector);
        vm.prank(agent);
        vault.execute(execution, routerCalldata, "");
    }

    function testRejectsAmountAboveAvailableBalance() public {
        vm.prank(owner);
        vault.withdraw(strategyId, 450 * UNIT);

        bytes memory routerCalldata = _swapCalldata(100 * UNIT, 2 ether);
        EQLTYVault.Execution memory execution = _execution(routerCalldata, 0);

        vm.expectRevert(EQLTYVault.LimitExceeded.selector);
        vm.prank(agent);
        vault.execute(execution, routerCalldata, "");
    }

    function testReturnsUnusedAuthorizedInputToAvailableBalance() public {
        bytes memory routerCalldata = _swapCalldata(60 * UNIT, 2 ether);
        EQLTYVault.Execution memory execution = _execution(routerCalldata, 0);
        bytes memory signature = _signExecution(execution);

        vm.prank(agent);
        vault.execute(execution, routerCalldata, signature);

        _assertEq(vault.availableBalance(strategyId), 440 * UNIT);
        _assertEq(inputToken.balanceOf(address(router)), 60 * UNIT);
        _assertEq(outputToken.balanceOf(owner), 2 ether);
    }

    function testRejectsAmountAboveRemainingTotalSpend() public {
        inputToken.mint(owner, 200 * UNIT);
        vm.prank(owner);
        strategyId = vault.createStrategy(
            agent,
            address(inputToken),
            address(outputToken),
            address(router),
            uint128(100 * UNIT),
            uint128(150 * UNIT),
            uint64(block.timestamp + 1 days),
            500,
            keccak256("limited owner")
        );
        vm.prank(owner);
        vault.fundStrategy(strategyId, 200 * UNIT);

        bytes memory firstCalldata = _swapCalldata(100 * UNIT, 2 ether);
        EQLTYVault.Execution memory firstExecution = _execution(firstCalldata, 0);
        bytes memory firstSignature = _signExecution(firstExecution);
        vm.prank(agent);
        vault.execute(firstExecution, firstCalldata, firstSignature);

        bytes memory secondCalldata = _swapCalldata(51 * UNIT, 1 ether);
        EQLTYVault.Execution memory secondExecution = _execution(secondCalldata, 1);
        secondExecution.amountIn = 51 * UNIT;

        vm.expectRevert(EQLTYVault.LimitExceeded.selector);
        vm.prank(agent);
        vault.execute(secondExecution, secondCalldata, "");
    }

    function testDomainSeparatorBindsVaultAddress() public {
        EQLTYVault anotherVault = new EQLTYVault(riskSigner, address(spender));

        require(
            vault.domainSeparator() != anotherVault.domainSeparator(), "DOMAIN_NOT_BOUND_TO_VAULT"
        );
    }
}
