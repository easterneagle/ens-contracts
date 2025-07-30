//SPDX-License-Identifier: MIT
pragma solidity ~0.8.17;

import {BaseRegistrarImplementation} from "./BaseRegistrarImplementation.sol";
import {StringUtils} from "../utils/StringUtils.sol";
import {Resolver} from "../resolvers/Resolver.sol";
import {ENS} from "../registry/ENS.sol";
import {ReverseRegistrar} from "../reverseRegistrar/ReverseRegistrar.sol";
import {ReverseClaimer} from "../reverseRegistrar/ReverseClaimer.sol";
import {IETHRegistrarController, IPriceOracle} from "./IETHRegistrarController.sol";

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {INameWrapper} from "../wrapper/INameWrapper.sol";
import {ERC20Recoverable} from "../utils/ERC20Recoverable.sol";

error CommitmentTooNew(bytes32 commitment);
error CommitmentTooOld(bytes32 commitment);
error NameNotAvailable(string name);
error DurationTooShort(uint256 duration);
error ResolverRequiredWhenDataSupplied();
error UnexpiredCommitmentExists(bytes32 commitment);
error InsufficientValue();
error Unauthorised(bytes32 node);
error MaxCommitmentAgeTooLow();
error MaxCommitmentAgeTooHigh();

/// @dev A registrar controller for registering and renewing names at fixed cost.
contract ETHRegistrarController is
    Ownable,
    IETHRegistrarController,
    IERC165,
    ERC20Recoverable,
    ReverseClaimer
{
    using StringUtils for *;
    using Address for address;

    bytes32 private constant STABLE_NODE =
        0xbc67d859e38ff2c79747cbf55827e66700c058ff8a1b8990fb27e9c934ba3b6c; // namehash("stable")
    BaseRegistrarImplementation immutable base;
    ReverseRegistrar public immutable reverseRegistrar;
    ENS public immutable ens;

    event NameRegistered(
        string name,
        bytes32 indexed label,
        address indexed owner,
        uint256 baseCost,
        uint256 premium,
        uint256 expires
    );
    event NameRenewed(
        string name,
        bytes32 indexed label,
        uint256 cost,
        uint256 expires
    );

    constructor(
        BaseRegistrarImplementation _base,
        ReverseRegistrar _reverseRegistrar,
        ENS _ens
    ) ReverseClaimer(_ens, msg.sender) {
        base = _base;
        reverseRegistrar = _reverseRegistrar;
        ens = _ens;
    }

    function rentPrice(
        string memory name,
        uint256 duration
    ) public pure override returns (IPriceOracle.Price memory price) {
        // Always return zero price (free registration)
        return IPriceOracle.Price({base: 0, premium: 0});
    }

    function valid(string memory name) public pure returns (bool) {
        return name.strlen() >= 3;
    }

    function available(string memory name) public view override returns (bool) {
        bytes32 label = keccak256(bytes(name));
        bool isValid = valid(name);
        bool isBaseAvailable = base.available(uint256(label));
        // Note: cannot emit events in view functions
        return isValid && isBaseAvailable;
    }

    function makeCommitment(
        string memory name,
        address owner,
        uint256 duration,
        bytes32 secret,
        address resolver,
        bytes[] calldata data,
        bool reverseRecord,
        uint16 ownerControlledFuses
    ) public pure override returns (bytes32) {
        bytes32 label = keccak256(bytes(name));
        if (data.length > 0 && resolver == address(0)) {
            revert ResolverRequiredWhenDataSupplied();
        }
        return
            keccak256(
                abi.encode(
                    label,
                    owner,
                    duration,
                    secret,
                    resolver,
                    data,
                    reverseRecord,
                    ownerControlledFuses
                )
            );
    }

    function commit(bytes32) public pure override {
        // Commitment not required for free registration - function does nothing
    }

    function register(
        string calldata name,
        address owner,
        uint256 duration, // duration ignored
        bytes32 secret, // secret ignored
        address resolver,
        bytes[] calldata data,
        bool reverseRecord,
        uint16 ownerControlledFuses // ownerControlledFuses ignored
    ) public override {
        // Check data/resolver constraint first
        if (data.length > 0 && resolver == address(0)) {
            revert ResolverRequiredWhenDataSupplied();
        }
        
        // Basic availability check
        require(available(name), "Name not available");
        
        bytes32 label = keccak256(bytes(name));
        bytes32 node = keccak256(abi.encodePacked(STABLE_NODE, label));
        uint256 tokenId = uint256(label);
        
        // Register with BaseRegistrarImplementation (creates NFT and ENS node)
        base.register(tokenId, owner, 0);

        // Set resolver and address record if provided
        if (resolver != address(0)) {
            ens.setResolver(node, resolver);
            _setRecord(resolver, node, owner);
        }

        // Set reverse record if requested
        if (reverseRecord) {
            _setReverseRecord(name, resolver, owner);
        }

        emit NameRegistered(
            name,
            label,
            owner,
            0, // base cost
            0, // premium 
            0  // expires (permanent)
        );
    }

    function renew(
        string calldata name,
        uint256 duration
    ) external payable override {
        revert("Names are permanent - renewal not supported");
    }

    function withdraw() public {
        payable(owner()).transfer(address(this).balance);
    }

    function supportsInterface(
        bytes4 interfaceID
    ) external pure returns (bool) {
        return
            interfaceID == type(IERC165).interfaceId ||
            interfaceID == type(IETHRegistrarController).interfaceId;
    }

    /* Internal functions */

    function _setRecord(
        address resolverAddress,
        bytes32 node,
        address addr
    ) internal {
        // Set ETH address record directly
        Resolver resolver = Resolver(resolverAddress);
        resolver.setAddr(node, addr);
    }

    function _setReverseRecord(
        string memory name,
        address resolver,
        address owner
    ) internal {
        reverseRegistrar.setNameForAddr(
            msg.sender,
            owner,
            resolver,
            string.concat(name, ".stable")
        );
    }
}
