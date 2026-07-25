// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { EQLTYVault } from "../src/EQLTYVault.sol";
import { VaultTestSupport, MockRouter } from "./support/VaultTestSupport.sol";

contract EQLTYVaultExecutionTest is VaultTestSupport {
    function testExecutesRiskSignedTrade() public {
        bytes memory routerCalldata = _swapCalldata(100 * UNIT, 2 ether);
        EQLTYVault.Execution memory execution = _execution(routerCalldata, 0);
        bytes memory signature = _signExecution(execution);

        vm.prank(agent);
        uint256 amountOut = vault.execute(execution, routerCalldata, signature);

        _assertEq(amountOut, 2 ether);
        _assertEq(outputToken.balanceOf(owner), 2 ether);
        _assertEq(vault.availableBalance(strategyId), 400 * UNIT);
        _assertEq(vault.executionNonce(strategyId), 1);
        _assertEq(inputToken.allowance(address(vault), address(spender)), 0);
    }

    function testRejectsPermitOutsideExecution() public {
        bytes32 permitHash = keccak256("permit");
        bytes memory permitSignature = _sign(permitHash);

        _assertEq(vault.isValidSignature(permitHash, permitSignature), 0xffffffff);
    }

    function testRejectsUnauthorizedCaller() public {
        bytes memory routerCalldata = _swapCalldata(100 * UNIT, 2 ether);
        EQLTYVault.Execution memory execution = _execution(routerCalldata, 0);
        bytes memory signature = _signExecution(execution);

        vm.expectRevert(EQLTYVault.Unauthorized.selector);
        vm.prank(outsider);
        vault.execute(execution, routerCalldata, signature);
    }

    function testRejectsInvalidRiskSignature() public {
        bytes memory routerCalldata = _swapCalldata(100 * UNIT, 2 ether);
        EQLTYVault.Execution memory execution = _execution(routerCalldata, 0);
        bytes memory signature = _sign(keccak256("invalid execution"));

        vm.expectRevert(EQLTYVault.InvalidRiskSignature.selector);
        vm.prank(agent);
        vault.execute(execution, routerCalldata, signature);
    }

    function testRejectsReplayedExecution() public {
        bytes memory routerCalldata = _swapCalldata(100 * UNIT, 2 ether);
        EQLTYVault.Execution memory execution = _execution(routerCalldata, 0);
        bytes memory signature = _signExecution(execution);

        vm.prank(agent);
        vault.execute(execution, routerCalldata, signature);

        vm.expectRevert(EQLTYVault.InvalidExecution.selector);
        vm.prank(agent);
        vault.execute(execution, routerCalldata, signature);
    }

    function testRejectsModifiedRouterCalldata() public {
        bytes memory signedCalldata = _swapCalldata(100 * UNIT, 2 ether);
        bytes memory modifiedCalldata = _swapCalldata(99 * UNIT, 2 ether);
        EQLTYVault.Execution memory execution = _execution(signedCalldata, 0);
        bytes memory signature = _signExecution(execution);

        vm.expectRevert(EQLTYVault.InvalidExecution.selector);
        vm.prank(agent);
        vault.execute(execution, modifiedCalldata, signature);
    }

    function testRejectsSlippageBelowStrategyFloor() public {
        bytes memory routerCalldata = _swapCalldata(100 * UNIT, 1.8 ether);
        EQLTYVault.Execution memory execution = _execution(routerCalldata, 0);
        execution.minAmountOut = 1.89 ether;
        bytes memory signature = _signExecution(execution);

        vm.expectRevert(EQLTYVault.InvalidExecution.selector);
        vm.prank(agent);
        vault.execute(execution, routerCalldata, signature);
    }

    function testRejectsOutputSentAwayFromVault() public {
        bytes32 permitHash = keccak256("redirected permit");
        bytes memory permitSignature = _sign(permitHash);
        bytes memory routerCalldata = abi.encodeCall(
            MockRouter.swapTo,
            (
                address(inputToken),
                address(outputToken),
                outsider,
                100 * UNIT,
                2 ether,
                permitHash,
                permitSignature
            )
        );
        EQLTYVault.Execution memory execution = _execution(routerCalldata, 0);
        bytes memory signature = _signExecution(execution);

        vm.expectRevert(EQLTYVault.InvalidExecution.selector);
        vm.prank(agent);
        vault.execute(execution, routerCalldata, signature);
    }

    function testSurfacesRouterFailure() public {
        bytes memory routerCalldata = abi.encodeCall(MockRouter.fail, ());
        EQLTYVault.Execution memory execution = _execution(routerCalldata, 0);
        bytes memory signature = _signExecution(execution);

        vm.expectPartialRevert(EQLTYVault.RouterCallFailed.selector);
        vm.prank(agent);
        vault.execute(execution, routerCalldata, signature);
    }
}
