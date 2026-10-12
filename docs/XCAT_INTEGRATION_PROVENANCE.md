# xCat core snapshot for integrated Mac station transport

`Sources/XCatIntegrationCore` is a byte-identical copy of the 17 Swift files in
`/Users/oliver/Documents/Projects/OM0RX-xCat/Sources/XCatCore` as inspected on
2026-10-12. Source owner: Oliver Bross OM0RX. License: GPL-3.0-only. The copy
includes the current working-tree contents because the observed-state and
remote-agent safety changes are not all committed at the source revision.

- Source HEAD: `b8f2e95527425247623dae366f94114bc0e1e94e`
- SHA-256 of `git diff --binary -- Sources/XCatCore` at copy time:
  `01439189a7d6aac7356c5cb36a1b8c9c9015a4185d3ab1837f9d917d750d824d`
- Verification at copy time: `diff -qr` reported no differences between source
  and copied core directories. The original xCat tree was not edited.

| File | SHA-256 |
| --- | --- |
| CATCommandProcessor.swift | `0dd07a46a9b91a95b61086ee8c34385ff1bb72c6eaad22c0a383b15e76e3dce9` |
| DXSpot.swift | `5131e8a164dfd6c2859abfe11be71f793c5a8051746fffb5f04392db299c70c7` |
| FlexRadioClient.swift | `49818aeb8a1bf75f965c51fcc01606553829b3059e982c7af81aa8c860fbb846` |
| LegacyXCATClient.swift | `f1bb10e9ba38181fd1946763315129f87644e456e6ec72788bebd0f62cd1ea8f` |
| Models.swift | `6de22c5c272bf8e2400a12343a63a1cc8fad549551eb8f4fd752753c2a51e390` |
| PropagationConditions.swift | `9b31f17bb3f1c1805262c2f895034ab119578559211e53707237db19b1a60357` |
| RemoteAgentAuth.swift | `e57838d5d35e2f87eac8b608f2fb3dafb6fe8d363db7735f3422423e79d729f0` |
| RemoteAgentClient.swift | `3a0d48a6d98a9e6f166eae9a3b8a6e0ca0c21ebd7e9cf0449bd9c56882f9536b` |
| RemoteAgentModels.swift | `a20772321f37f1fc4050f04b2a6a58d6d508036189f4226b589372cdc0153f6b` |
| RemoteStationConfiguration.swift | `c0ba4be74c40a3b1cb1095b6aa7ba5efe3ccc9c72f933936e0361259499823c1` |
| RigCtlCommandProcessor.swift | `080c0f645a32bb02196473bfadd60eba8a68a361fd11a3bf1cf5c0fa9b4e1dc9` |
| Rotator.swift | `1cd3868a284d31b37bf17f516b617a1d1cf03f1ffdc08a12eab7ee8e2016b105` |
| SimulatedRadio.swift | `cf058b4c0d9a9373ea7412e45ddb15a1fc5da38d12c37bc7a6ce380013072bf6` |
| SmartLinkAuth.swift | `fe8ee81ee7ed32a3034e5800b373cdbc975392b985a5932b11ee78c6f077e2f0` |
| SmartLinkBroker.swift | `ddc18863d793d3f09da7d53e07af1fa2e1e55d18d8e3326baef805b3e81fbca0` |
| SmartLinkRadioClient.swift | `29142892e67c9cd9b3906d9a7e3308f6b517184b91270cb736e6dfb1618f6d4f` |
| TCPCommandServer.swift | `4c54694196c5a2955f5b0f5ec98d2b01c022a8cfe7a3bce87a8d7357e5c52254` |
