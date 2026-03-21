// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title InverseClawEscrow
 * @notice Holds USDC deposits for the Inverse Claw protocol.
 *
 * A customer deposits USDC into escrow when booking a service. The
 * business can release (refund to customer) or capture (take payment).
 * If neither happens within 7 days, anyone can expire the deposit and
 * the customer gets their money back.
 *
 * No admin, no owner, no upgradeability. Fully trustless.
 */
contract InverseClawEscrow {
    using SafeERC20 for IERC20;

    enum Status { None, Held, Released, Captured, Expired }

    struct Deposit {
        address depositor;
        address businessWallet;
        uint256 amount;
        uint256 expiresAt;
        Status status;
    }

    IERC20 public immutable usdc;
    uint256 public constant EXPIRY_DURATION = 7 days;

    mapping(bytes32 => Deposit) public deposits;

    event Deposited(
        bytes32 indexed depositId,
        address indexed depositor,
        address indexed businessWallet,
        uint256 amount,
        uint256 expiresAt
    );
    event Released(bytes32 indexed depositId);
    event Captured(bytes32 indexed depositId);
    event Expired(bytes32 indexed depositId);

    constructor(address _usdc) {
        usdc = IERC20(_usdc);
    }

    /**
     * @notice Customer deposits USDC into escrow.
     * @dev Customer must approve this contract to spend `amount` of USDC first.
     * @param depositId Unique identifier (keccak256 of the server's deposit reference)
     * @param businessWallet Address that can capture/release this deposit
     * @param amount USDC amount (6 decimals)
     */
    function deposit(
        bytes32 depositId,
        address businessWallet,
        uint256 amount
    ) external {
        require(deposits[depositId].status == Status.None, "Deposit already exists");
        require(amount > 0, "Amount must be positive");
        require(businessWallet != address(0), "Invalid business wallet");

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        uint256 expiresAt = block.timestamp + EXPIRY_DURATION;

        deposits[depositId] = Deposit({
            depositor: msg.sender,
            businessWallet: businessWallet,
            amount: amount,
            expiresAt: expiresAt,
            status: Status.Held
        });

        emit Deposited(depositId, msg.sender, businessWallet, amount, expiresAt);
    }

    /**
     * @notice Business releases the deposit — USDC goes back to the customer.
     * @dev Only callable by the business wallet recorded in the deposit.
     */
    function release(bytes32 depositId) external {
        Deposit storage d = deposits[depositId];
        require(d.status == Status.Held, "Deposit not held");
        require(msg.sender == d.businessWallet, "Not authorized");

        d.status = Status.Released;
        usdc.safeTransfer(d.depositor, d.amount);

        emit Released(depositId);
    }

    /**
     * @notice Business captures the deposit — USDC goes to the business.
     * @dev Only callable by the business wallet recorded in the deposit.
     */
    function capture(bytes32 depositId) external {
        Deposit storage d = deposits[depositId];
        require(d.status == Status.Held, "Deposit not held");
        require(msg.sender == d.businessWallet, "Not authorized");

        d.status = Status.Captured;
        usdc.safeTransfer(d.businessWallet, d.amount);

        emit Captured(depositId);
    }

    /**
     * @notice Expire a deposit after the timeout — USDC goes back to the customer.
     * @dev Callable by anyone after expiresAt. Safe default: customer gets money back.
     */
    function expire(bytes32 depositId) external {
        Deposit storage d = deposits[depositId];
        require(d.status == Status.Held, "Deposit not held");
        require(block.timestamp >= d.expiresAt, "Not yet expired");

        d.status = Status.Expired;
        usdc.safeTransfer(d.depositor, d.amount);

        emit Expired(depositId);
    }

    /**
     * @notice Read deposit details.
     */
    function getDeposit(bytes32 depositId) external view returns (
        address depositor,
        address businessWallet,
        uint256 amount,
        uint256 expiresAt,
        Status status
    ) {
        Deposit storage d = deposits[depositId];
        return (d.depositor, d.businessWallet, d.amount, d.expiresAt, d.status);
    }
}
