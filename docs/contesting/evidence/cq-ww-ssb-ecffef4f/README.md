# CQ WW SSB 1.3.4 candidate evidence

- Frozen source: `ecffef4f32fdd3e9a2441d293dbf21a80fd7d2ce`
- Packaged and installed version: `1.3.4`
- Packaged native acceptance: 35/35 PASS, SHA-256
  `18e7fd763ceaa03302c132fd15756706270dcfd570ca9e06c93cde64b5058064`
- Installed native acceptance: 35/35 PASS, SHA-256
  `db135d2e0aeb2101dded7ed6fa2712958de14bed08a9e6a0842397aa3c743105`
- Both reports declare `scope: integrated-local-ui`,
  `production_singleton: false`, and `station_io: false`.
- The installed bundle's embedded Python 3.12 and embedded Not1MM source passed
  all 24 disposable `test_cq_ww_ssb_host.py` tests.
- Installed executable SHA-256:
  `83d5a5969ef17294be8a5a0f569e35168b1b2fedc5fb86c930fdfe723257f720`
- Installed worker SHA-256:
  `705ee22e02dc315cc7b28392c803486f2aec7286aa7ce73c2af2678c93f42c43`
- Installed embedded Python receipt SHA-256:
  `d491635753462e2e687aab305d2d9bea9f368262249fc0fd82a2f30979f42847`
- Installed and packaged Developer ID deep/strict signature verification: PASS.

The acceptance run was isolated and synthetic. It did not use station I/O or
modify production QSOs.
