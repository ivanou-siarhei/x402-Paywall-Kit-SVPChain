const { expect } = require('chai');
const { ethers } = require('hardhat');

const TYPES = {
  PaymentAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'asset', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'validBefore', type: 'uint64' },
    { name: 'resourceHash', type: 'bytes32' },
  ],
};

async function signAuth(signer, contractAddr, auth) {
  const net = await ethers.provider.getNetwork();
  const domain = {
    name: 'Svp402Settlement',
    version: '1',
    chainId: Number(net.chainId),
    verifyingContract: contractAddr,
  };
  return signer.signTypedData(domain, TYPES, auth);
}

function authFor({ from, to, asset, amount, nonce, validBefore, resourceHash }) {
  return { from, to, asset, amount, nonce, validBefore, resourceHash };
}

describe('Svp402Settlement', function () {
  async function deploy(feeBps = 0n) {
    const [payer, payee, relayer, stranger] = await ethers.getSigners();
    const Token = await ethers.getContractFactory('MockUSD');
    const token = await Token.deploy();
    const S = await ethers.getContractFactory('Svp402Settlement');
    const s = await S.deploy(feeBps, payee.address);
    await token.mint(payer.address, 1_000_000n); // 1.0 mUSD (6 dec)
    return { payer, payee, relayer, stranger, token, s };
  }

  it('settle: pulls funds via transferFrom and emits Settled', async function () {
    const { payer, payee, relayer, token, s } = await deploy();
    const addr = await s.getAddress();
    const taddr = await token.getAddress();
    await token.connect(payer).approve(addr, 100_000n);
    const auth = authFor({
      from: payer.address, to: payee.address, asset: taddr,
      amount: 10_000n, // 0.01
      nonce: ethers.id('n1'),
      validBefore: Math.floor(Date.now() / 1000) + 300,
      resourceHash: ethers.id('GET /api/price'),
    });
    const sig = await signAuth(payer, addr, auth);
    await expect(s.connect(relayer).settle(auth, sig))
      .to.emit(s, 'Settled')
      .withArgs(payer.address, payee.address, taddr, 10_000n, auth.nonce, auth.resourceHash);
    expect(await token.balanceOf(payee.address)).to.equal(10_000n);
    expect(await s.isNonceUsed(payer.address, auth.nonce)).to.equal(true);
  });

  it('replay: second settle with same nonce reverts', async function () {
    const { payer, payee, relayer, token, s } = await deploy();
    const addr = await s.getAddress();
    await token.connect(payer).approve(addr, 100_000n);
    const auth = authFor({
      from: payer.address, to: payee.address, asset: await token.getAddress(),
      amount: 10_000n, nonce: ethers.id('n-replay'),
      validBefore: Math.floor(Date.now() / 1000) + 300,
      resourceHash: ethers.id('r'),
    });
    const sig = await signAuth(payer, addr, auth);
    await s.connect(relayer).settle(auth, sig);
    await expect(s.connect(relayer).settle(auth, sig)).to.be.revertedWithCustomError(s, 'NonceUsed');
  });

  it('expired: validBefore in the past reverts', async function () {
    const { payer, payee, relayer, token, s } = await deploy();
    const addr = await s.getAddress();
    await token.connect(payer).approve(addr, 100_000n);
    const auth = authFor({
      from: payer.address, to: payee.address, asset: await token.getAddress(),
      amount: 10_000n, nonce: ethers.id('n-exp'),
      validBefore: Math.floor(Date.now() / 1000) - 10,
      resourceHash: ethers.id('r'),
    });
    const sig = await signAuth(payer, addr, auth);
    await expect(s.connect(relayer).settle(auth, sig)).to.be.revertedWithCustomError(s, 'Expired');
  });

  it('tampered resource: changed resourceHash fails signature check', async function () {
    const { payer, payee, relayer, token, s } = await deploy();
    const addr = await s.getAddress();
    await token.connect(payer).approve(addr, 100_000n);
    const auth = authFor({
      from: payer.address, to: payee.address, asset: await token.getAddress(),
      amount: 10_000n, nonce: ethers.id('n-tamper'),
      validBefore: Math.floor(Date.now() / 1000) + 300,
      resourceHash: ethers.id('original'),
    });
    const sig = await signAuth(payer, addr, auth);
    const tampered = { ...auth, resourceHash: ethers.id('other-resource') };
    await expect(s.connect(relayer).settle(tampered, sig)).to.be.revertedWithCustomError(s, 'InvalidSignature');
  });

  it('wrong signer: stranger signature reverts', async function () {
    const { payer, payee, relayer, stranger, token, s } = await deploy();
    const addr = await s.getAddress();
    await token.connect(payer).approve(addr, 100_000n);
    const auth = authFor({
      from: payer.address, to: payee.address, asset: await token.getAddress(),
      amount: 10_000n, nonce: ethers.id('n-stranger'),
      validBefore: Math.floor(Date.now() / 1000) + 300,
      resourceHash: ethers.id('r'),
    });
    const sig = await signAuth(stranger, addr, auth);
    await expect(s.connect(relayer).settle(auth, sig)).to.be.revertedWithCustomError(s, 'InvalidSignature');
  });

  it('allowance: missing approve reverts', async function () {
    const { payer, payee, relayer, token, s } = await deploy();
    const addr = await s.getAddress();
    const auth = authFor({
      from: payer.address, to: payee.address, asset: await token.getAddress(),
      amount: 10_000n, nonce: ethers.id('n-noallow'),
      validBefore: Math.floor(Date.now() / 1000) + 300,
      resourceHash: ethers.id('r'),
    });
    const sig = await signAuth(payer, addr, auth);
    await expect(s.connect(relayer).settle(auth, sig)).to.be.reverted;
  });

  it('cancelNonce: blocks later settle', async function () {
    const { payer, payee, relayer, token, s } = await deploy();
    const addr = await s.getAddress();
    await token.connect(payer).approve(addr, 100_000n);
    const nonce = ethers.id('n-cancel');
    await s.connect(payer).cancelNonce(nonce);
    expect(await s.isNonceUsed(payer.address, nonce)).to.equal(true);
    const auth = authFor({
      from: payer.address, to: payee.address, asset: await token.getAddress(),
      amount: 10_000n, nonce,
      validBefore: Math.floor(Date.now() / 1000) + 300,
      resourceHash: ethers.id('r'),
    });
    const sig = await signAuth(payer, addr, auth);
    await expect(s.connect(relayer).settle(auth, sig)).to.be.revertedWithCustomError(s, 'NonceUsed');
  });

  it('settleBatch: two payments in one tx', async function () {
    const { payer, payee, relayer, token, s } = await deploy();
    const addr = await s.getAddress();
    const taddr = await token.getAddress();
    await token.connect(payer).approve(addr, 100_000n);
    const base = {
      from: payer.address, to: payee.address, asset: taddr, amount: 5_000n,
      validBefore: Math.floor(Date.now() / 1000) + 300, resourceHash: ethers.id('r'),
    };
    const a1 = { ...base, nonce: ethers.id('b1') };
    const a2 = { ...base, nonce: ethers.id('b2') };
    const s1 = await signAuth(payer, addr, a1);
    const s2 = await signAuth(payer, addr, a2);
    await s.connect(relayer).settleBatch([a1, a2], [s1, s2]);
    expect(await token.balanceOf(payee.address)).to.equal(10_000n);
  });
});
