# CQ WW SSB 1.3.3 candidate evidence

- Frozen source: `b70ba7f92d4e8598b0d4ad2f790cf28e324cda85`
- Packaged and installed version: `1.3.3`
- Packaged native acceptance: 35/35 PASS, SHA-256
  `ac9a2520ed558a8ea2f949cc42a7a91e5ac1f949039ca34cc7ef1c26fe8746bf`
- Installed native acceptance: 35/35 PASS, SHA-256
  `5cb2e742e7679ed4f0f5422326cded03bb55f02dd78f2a4aa928def869ddbfe6`
- Both reports declare `scope: integrated-local-ui`,
  `production_singleton: false`, and `station_io: false`.
- The installed bundle's embedded Python 3.12 and embedded Not1MM source passed
  all 24 disposable `test_cq_ww_ssb_host.py` tests.
- Installed executable SHA-256:
  `3a7556a74d3d3f4dda2f952d5ed34f1bd0a574e60d276b289a8281a6586db37d`
- Installed worker SHA-256:
  `9b4fa506517b17b9abc9a0618ec85e957f0f617ac9bd467601ffd6607abfabc4`
- Installed embedded Python receipt SHA-256:
  `63bcfa0a0f0cf9507bc62a6d95ba6fb52bd9eb893c30297fe3107b5ac6754345`
- Installed and packaged Developer ID deep/strict signature verification: PASS.

The acceptance run was isolated and synthetic. It did not use station I/O or
modify production QSOs.
