// Deploy Svp402Settlement to SVPChain testnet 2517.
// Usage: PRIVATE_KEY=0x... npx hardhat run scripts/deploy.js --network svpTestnet
// Needs testnet SVP for gas (faucet: https://www.svpchain.org/faucet).
const { ethers } = require('hardhat');

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deployer:', deployer.address);
  const S = await ethers.getContractFactory('Svp402Settlement');
  const s = await S.deploy(0n, deployer.address); // feeBps=0, feeRecipient=deployer
  await s.waitForDeployment();
  const addr = await s.getAddress();
  console.log('Svp402Settlement deployed at', addr);
  console.log('Explorer: https://explorer.svpchain.com/address/' + addr);
  console.log('Verify: open address page -> Code -> Verify & Publish (solc 0.8.24, evm cancun, OZ 5.x).');
}

main().catch((e) => { console.error(e); process.exit(1); });
