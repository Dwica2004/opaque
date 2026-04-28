// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @dev Free-mint ERC-20 for Arbitrum Sepolia testing.
 * Anyone can mint up to 10,000 USDC at a time for demo purposes.
 */
contract MockUSDC is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 10_000 * 10**6; // 10,000 USDC (6 decimals)
    uint256 public constant MAX_MINT = 100_000 * 10**6;     // 100k max per address
    mapping(address => uint256) public minted;

    constructor() ERC20("Mock USDC", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mint free test USDC (10,000 per call, max 100k per wallet)
    function faucet() external {
        require(minted[msg.sender] + FAUCET_AMOUNT <= MAX_MINT, "MockUSDC: Faucet limit reached");
        minted[msg.sender] += FAUCET_AMOUNT;
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice Admin mint for deployment demos
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
