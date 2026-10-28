import os, sys, unittest,tempfile
from pathlib import Path
os.environ['XLOG_CONTEST_N1MM_UDP_ALLOWED'] = '0'
os.environ['XLOG_CONTEST_ALLOW_UDP'] = '0'
runtime=Path('/tmp/xlog-phase6-20261029-0ce97a12/agents/persistence/runtime');runtime.mkdir(exist_ok=True)
tempfile.tempdir=str(runtime.resolve())
sys.dont_write_bytecode = True
sys.path[:0] = ['/Users/oliver/Documents/Projects/OM0RX-xLog/python', '/Users/oliver/Documents/Projects/OM0RX-xLog/python/tests']
names = ['test_remediation_import_replica', 'test_remediation_wae', 'test_recorder']
suite = unittest.defaultTestLoader.loadTestsFromNames(names)
result = unittest.TextTestRunner(verbosity=2).run(suite)
sys.exit(not result.wasSuccessful())
