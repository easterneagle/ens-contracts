//SPDX-License-Identifier: MIT
pragma solidity >=0.8.17 <0.9.0;

import "../registry/ENS.sol";
import "./profiles/ABIResolver.sol";
import "./profiles/AddrResolver.sol";
import "./profiles/ContentHashResolver.sol";
import "./profiles/DNSResolver.sol";
import "./profiles/InterfaceResolver.sol";
import "./profiles/NameResolver.sol";
import "./profiles/PubkeyResolver.sol";
import "./profiles/TextResolver.sol";
import "./Multicallable.sol";
// import {ReverseClaimer} from "../reverseRegistrar/ReverseClaimer.sol"; // Commented out for Stable Name Service
import {INameWrapper} from "../wrapper/INameWrapper.sol";
import {COIN_TYPE_ETH} from "../utils/ENSIP19.sol";

/// A simple resolver anyone can use; only allows the owner of a node to set its
/// address.
contract PublicResolver is
    Multicallable,
    ABIResolver,
    AddrResolver,
    ContentHashResolver,
    DNSResolver,
    InterfaceResolver,
    NameResolver,
    PubkeyResolver,
    TextResolver
    // ReverseClaimer removed for Stable Name Service compatibility
{
    ENS immutable ens;
    INameWrapper immutable nameWrapper;
    address immutable trustedETHController;
    address immutable trustedReverseRegistrar;

    /// A mapping of operators. An address that is authorised for an address
    /// may make any changes to the name that the owner could, but may not update
    /// the set of authorisations.
    /// (owner, operator) => approved
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    /// A mapping of delegates. A delegate that is authorised by an owner
    /// for a name may make changes to the name's resolver, but may not update
    /// the set of token approvals.
    /// (owner, name, delegate) => approved
    mapping(address => mapping(bytes32 => mapping(address => bool)))
        private _tokenApprovals;
        
    /// Bidirectional mapping: address to ENS name
    mapping(address => string) private addressToName;
    mapping(address => bytes32) private addressToNode;

    // Logged when an operator is added or removed.
    event ApprovalForAll(
        address indexed owner,
        address indexed operator,
        bool approved
    );

    // Logged when a delegate is approved or  an approval is revoked.
    event Approved(
        address owner,
        bytes32 indexed node,
        address indexed delegate,
        bool indexed approved
    );

    constructor(
        ENS _ens,
        INameWrapper wrapperAddress,
        address _trustedETHController,
        address _trustedReverseRegistrar
    ) {
        ens = _ens;
        nameWrapper = wrapperAddress; // Can be zero address for Stable Name Service
        trustedETHController = _trustedETHController;
        trustedReverseRegistrar = _trustedReverseRegistrar;
        // ReverseClaimer constructor call removed for Stable Name Service compatibility
    }

    /// @dev See {IERC1155-setApprovalForAll}.
    function setApprovalForAll(address operator, bool approved) external {
        require(
            msg.sender != operator,
            "ERC1155: setting approval status for self"
        );

        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    /// @dev See {IERC1155-isApprovedForAll}.
    function isApprovedForAll(
        address account,
        address operator
    ) public view returns (bool) {
        return _operatorApprovals[account][operator];
    }

    /// @dev Approve a delegate to be able to updated records on a node.
    function approve(bytes32 node, address delegate, bool approved) external {
        require(msg.sender != delegate, "Setting delegate status for self");

        _tokenApprovals[msg.sender][node][delegate] = approved;
        emit Approved(msg.sender, node, delegate, approved);
    }

    /// @dev Check to see if the delegate has been approved by the owner for the node.
    function isApprovedFor(
        address owner,
        bytes32 node,
        address delegate
    ) public view returns (bool) {
        return _tokenApprovals[owner][node][delegate];
    }

    function isAuthorised(bytes32 node) internal view override returns (bool) {
        if (
            msg.sender == trustedETHController ||
            msg.sender == trustedReverseRegistrar
        ) {
            return true;
        }
        address owner = ens.owner(node);
        // Only use nameWrapper if it's not zero address (for Stable Name Service compatibility)
        if (address(nameWrapper) != address(0) && owner == address(nameWrapper)) {
            owner = nameWrapper.ownerOf(uint256(node));
        }
        return
            owner == msg.sender ||
            isApprovedForAll(owner, msg.sender) ||
            isApprovedFor(owner, node, msg.sender);
    }

    function supportsInterface(
        bytes4 interfaceID
    )
        public
        view
        override(
            Multicallable,
            ABIResolver,
            AddrResolver,
            ContentHashResolver,
            DNSResolver,
            InterfaceResolver,
            NameResolver,
            PubkeyResolver,
            TextResolver
        )
        returns (bool)
    {
        return super.supportsInterface(interfaceID);
    }
    
    /// @dev Get the ENS name associated with an address
    /// @param addr The address to query
    /// @return The associated ENS name, or empty string if none
    function getName(address addr) external view returns (string memory) {
        return addressToName[addr];
    }
    
    /// @dev Get the ENS node associated with an address
    /// @param addr The address to query
    /// @return The associated ENS node, or 0x0 if none
    function getNode(address addr) external view returns (bytes32) {
        return addressToNode[addr];
    }
    
    /// @dev Override setAddr to update bidirectional mapping
    function setAddr(
        bytes32 node,
        address _addr
    ) external override(AddrResolver) authorised(node) {
        // Get previous address to clear old mapping
        address previousAddr = addr(node);
        if (previousAddr != address(0) && addressToNode[previousAddr] == node) {
            delete addressToName[previousAddr];
            delete addressToNode[previousAddr];
        }
        
        // Call parent implementation manually
        versionable_addresses[recordVersions[node]][node][COIN_TYPE_ETH] = abi.encodePacked(_addr);
        emit AddrChanged(node, _addr);
        emit AddressChanged(node, COIN_TYPE_ETH, abi.encodePacked(_addr));
        
        // Update bidirectional mapping
        if (_addr != address(0)) {
            addressToNode[_addr] = node;
            // Get name if available
            string memory nodeName = versionable_names[recordVersions[node]][node];
            if (bytes(nodeName).length > 0) {
                addressToName[_addr] = nodeName;
            }
        }
    }
    
    /// @dev Override setName to update bidirectional mapping
    function setName(
        bytes32 node,
        string calldata newName
    ) external override(NameResolver) authorised(node) {
        // Call parent implementation manually
        versionable_names[recordVersions[node]][node] = newName;
        emit NameChanged(node, newName);
        
        // Update bidirectional mapping if this node has an address
        address nodeAddr = addr(node);
        if (nodeAddr != address(0) && addressToNode[nodeAddr] == node) {
            addressToName[nodeAddr] = newName;
        }
    }
}
