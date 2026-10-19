"""Explicit nonvisual translation boundary for the React-owned CQ WW desk.

This is not a PyQt module replacement. The import overlay routes only the
audited upstream imports here; attempts to instantiate a Qt dialog fail.
"""


class QCoreApplication:
    @staticmethod
    def translate(context, text):
        if not isinstance(context, str) or not isinstance(text, str):
            raise TypeError("Translation requires text")
        return text


QApplication = QCoreApplication


class UnsupportedDialog:
    def __init__(self, *args, **kwargs):
        raise NotImplementedError("Native import dialogs are not supported by this host")


QDialog = QProgressDialog = QPushButton = UnsupportedDialog


class Qt:
    """No enum surface is admitted until an actual supported callback needs it."""


class QtWidgets:
    QApplication = QApplication
