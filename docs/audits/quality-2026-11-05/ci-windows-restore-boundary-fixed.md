# Windows restore boundary fix — native source tests PASSED

[Native core run 42052034057](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42052034057/job/127330369531) qualified application fix source **d2d22afb419fe13710f71d36a27281e6879970a0** on **windows-2022**. This is a filtered source test run: **no versioned application candidate or package was built**, and it does not qualify installer/GUI/ordinary-user/UAC/hardware operation. Original **1.5.20 / 3d9cb0981c30764f1188db350ffebc22a5f328a7** package bytes and failed outcomes remain unchanged.

The exact filter was **WindowsRestorePathBoundaryTests|LongRestoreRenameTests|RestoreAtomicityTests|BackupEnvelopePortableTests|BackupRestoreAuthorityTests**, draft_precision_phases=false. The selection receipt proves **36 completed test records**, all passed, childExitCode=0, fullProductQualification=false. Actual final output reports **19 XCTest / 0 failures / 9.503 seconds**, followed by **17 Swift Testing tests / 2 suites / 21.045 seconds**. The 17 count is the measured Windows count, including parameterized test records as printed by Swift Testing.

The original four positive regressions are **byte-identical** to red source **47ee6cdaf3235c05aa797e8017751b9fe898bb34**: WindowsRestorePathBoundaryTests.swift SHA-256 **9ddc1d4e16a8fc08ca187e084d085a515a5d96472e3c5a2174be4427bd186362**. [Baseline run 42047371176](ci-windows-restore-boundary-baseline.md) remains **4 unexpected failures**. All four now pass **17 stages each**, with **68 sanitized stage receipts** in the companion JSON. They reach final reopened contact identity/count, selected Unicode comment, unknown ADIF field, durable settings, selected reference bytes, previous-reference rollback bytes, unchanged selected backup seal and previous-database contact verification.

Native rename tests passed long Unicode file/directory moves and long-source return; occupied file and directory rejection without overwrite/merge; missing source; Windows invalid name; short injected FileManager failure; late completion rollback; and a genuine occupied native rollback destination retaining all copies plus the recovery marker and blocking current/subsequent owners. Restore atomicity and envelope/authority tests also passed.

Exact completed XCTest names:

- BackupRestoreAuthorityTests.testAcceptedRestorePreservesLinkedIDsAndRecoveryHistoryWithoutDetachingOrUploading
- BackupRestoreAuthorityTests.testExplicitSettingsRestoreSelectsBackupAuthorityWithoutInheritingConsent
- BackupRestoreAuthorityTests.testKeepSettingsRejectsEitherDestinationCoordinateBeforeReplacingLinkedHistory
- BackupRestoreAuthorityTests.testMatchingDestinationRetainsStationConfigurationButRequiresFreshSyncConsent
- BackupRestoreAuthorityTests.testMissingBackupSettingsCannotSilentlyRetainUnknownDestination
- BackupRestoreAuthorityTests.testReplacementOfAnInspectedPackageCannotInstallAnotherDestination
- LongRestoreRenameTests.testInvalidLongWindowsNativeNameIsRejectedBeforeMove
- LongRestoreRenameTests.testLongDirectoryRenameAndLongSourceReturnPreserveChildren
- LongRestoreRenameTests.testLongReferenceAndDatabaseRollbackAfterLateCompletionFailure
- LongRestoreRenameTests.testLongUnicodeFileRenameAndLongSourceReturnPreserveBytes
- LongRestoreRenameTests.testMissingLongSourceDoesNotPublishDestination
- LongRestoreRenameTests.testOccupiedLongDirectoryDestinationNeverMergesChildren
- LongRestoreRenameTests.testOccupiedLongFileDestinationNeverOverwritesEitherCopy
- LongRestoreRenameTests.testOccupiedNativeRollbackDestinationPreservesCopiesAndRecoveryBlock
- LongRestoreRenameTests.testShortRenameStillDispatchesInjectedFileManagerFailure
- WindowsRestorePathBoundaryTests.testDirectRestoreAtTemp91
- WindowsRestorePathBoundaryTests.testDirectRestoreAtTemp92
- WindowsRestorePathBoundaryTests.testRPCRestoreAtTemp91
- WindowsRestorePathBoundaryTests.testRPCRestoreAtTemp92

Exact completed Swift Testing names:

- metadataPreservesRealFileTypesAndExactByteSizes()
- metadataRejectsMissingTypesAndInvalidRegularFileSizes()
- nativeWindowsDirectoryBoundariesPreserveUnicodeBytesAndRejectFileCollisions(units:) with 3 test cases
- captureRejectsCanonicallyEquivalentNamesBeforeDictionaryInsertion()
- materializationRejectsCanonicalFilenameCollisionsBeforeCreatingItsRoot()
- directoryParentsUseNonrecursiveCreationAndRejectFileCollisions()
- directoryParentFailureAndMissingReaderErrorsArePropagated()
- frozenBytesRoundTripAndPlanBinding()
- verifiedRemoteEnvelopeMaterializesIdempotentlyWithoutInstalling()
- everyPayloadIsBound(path:) with 5 test cases
- missingExtraLinksAndStrippedSealRejected()
- untrustedEnvelopePathsVersionsAndHashesRejected()
- restoresOnlyValidatedReferenceBytes()
- legacyLocalDatabaseCompatibleButFullPackageOperationsFailExplicitly()
- "The actual modern restore installs all components from one selected package snapshot"
- "Later publication failures retain the complete original workspace" with 3 test cases
- "An unsuccessful rollback blocks this owner and subsequent launches"

| Artifact ID | Bytes | ZIP SHA-256 |
|---|---:|---|
| 13428815535 | 944 | 26e129feff81f735f6c3ac5e72cf7ad21f211143bdf42e2e5ebc861ca3de75b2 |
| 13428395791 | 1752 | 651779c388762828c17669305cd7eca3d4e72c1cb694313ab58811eadf890a33 |

Both ZIPs and final **737862-byte** log were downloaded/hash-verified. Log SHA-256 **a8773ab26eec14b80826d690a5e6de8231bcf36fc555c614ceef7f8ba72abf5c**; selection JSON SHA-256 **860f6cfc75f8adb012e9cf6be3624f52797cd0bd39c1f5c1c07b80f86a4d7af8**. Ordinary CI **42052031544 passed**; verified exact-source redundant single-Mac prototype push **42052031505 was cancelled**, not passed. No retry or source edit was performed by this monitoring agent.
