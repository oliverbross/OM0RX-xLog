#!/usr/bin/env python3
"""Regression checks for explicit portable IQ source-list selection."""
from pathlib import Path
import unittest

from check_portable_iq_sources import portable_iq_sources


class PortableIQSourcesTests(unittest.TestCase):
    def test_ignores_preceding_linux_else_and_nested_mac_conditionals(self):
        manifest = '''
#if os(Linux)
let vault = ["Linux.swift"]
#else
let vault = []
#endif
#if os(macOS)
#if DEBUG
let nativeMode = true
#else
let nativeMode = false
#endif
.target(name: "XCatIntegrationCore", linkerSettings: [.linkedFramework("Network")])
#else
.target(name: "XCatIntegrationCore", exclude: ["Radio.swift"], sources: ["IQ.swift", "Frame.swift"])
#endif
'''
        self.assertEqual(portable_iq_sources(manifest), ['IQ.swift', 'Frame.swift'])

    def test_actual_manifest_keeps_the_complete_declared_slice(self):
        manifest = (Path(__file__).resolve().parents[1] / 'Package.swift').read_text()
        self.assertEqual(portable_iq_sources(manifest), [
            'XCatError.swift', 'PropagationConditions.swift', 'TCIProtocol.swift',
            'TCIIQFrame.swift', 'FlexIQTransport.swift', 'FlexIQResources.swift', 'FlexIQSubscription.swift'])

    def test_target_without_sources_cannot_borrow_another_targets_list(self):
        manifest = '''.target(name: "XCatIntegrationCore", linkerSettings: [])
            .target(name: "OtherCore", sources: ["Wrong.swift"])'''
        with self.assertRaisesRegex(ValueError, 'Cannot uniquely identify'):
            portable_iq_sources(manifest)

    def test_missing_and_empty_lists_fail_closed(self):
        for manifest in ['', '.target(name: "XCatIntegrationCore", sources: [])']:
            with self.subTest(manifest=manifest), self.assertRaises(ValueError):
                portable_iq_sources(manifest)

    def test_ambiguous_explicit_lists_fail_closed(self):
        target = '.target(name: "XCatIntegrationCore", sources: ["IQ.swift"])'
        with self.assertRaisesRegex(ValueError, 'Cannot uniquely identify'):
            portable_iq_sources(target + '\n' + target)


if __name__ == '__main__':
    unittest.main()
