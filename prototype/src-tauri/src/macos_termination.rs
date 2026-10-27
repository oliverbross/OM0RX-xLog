//! Cocoa's Dock Quit sends terminate: rather than Tauri RequestExit. Install
//! only the missing delegate veto, then route through the existing preparation
//! and output-release path. Never override a delegate's own termination policy.
use objc2::{msg_send, sel, runtime::{AnyClass, AnyObject, Bool, Sel}};
use std::{ffi::c_void, sync::OnceLock};

static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
#[link(name="objc")]
extern "C" {
    fn class_addMethod(class: *const AnyClass, selector: Sel, implementation: *const c_void, encoding: *const std::ffi::c_char) -> Bool;
}

extern "C" fn should_terminate(_: &AnyObject, _: Sel, _: *mut AnyObject) -> usize {
    if let Some(app)=APP.get() { app.exit(0); }
    // NSTerminateCancel: our queued RequestExit owns any later actual exit.
    // No final-moment write or unconditional Cocoa termination is claimed.
    0
}

pub fn install(app: &tauri::AppHandle) -> Result<(), String> {
    if objc2::MainThreadMarker::new().is_none(){return Err("Termination guard requires the native main thread.".into());}
    let class=AnyClass::get(c"NSApplication").ok_or("NSApplication unavailable")?;
    // SAFETY: AppKit is running on its main thread; Tao owns this delegate for
    // the application lifetime. The added selector has Cocoa's NSUInteger ABI.
    unsafe {
        let application: *mut AnyObject=msg_send![class, sharedApplication];
        let delegate: *mut AnyObject=msg_send![application, delegate];
        let delegate=delegate.as_ref().ok_or("Native application delegate unavailable")?;
        let class=delegate.class();
        let mut parent=Some(class);let mut tao=false;
        while let Some(value)=parent {if value.name()==c"TaoAppDelegateParent"{tao=true;break;}parent=value.superclass();}
        if !tao||class.instance_method(sel!(applicationShouldTerminate:)).is_some(){return Err("Native termination policy changed; refusing to replace it.".into());}
        APP.set(app.clone()).map_err(|_|"Termination guard already installed")?;
        if !class_addMethod(class,sel!(applicationShouldTerminate:),should_terminate as *const c_void,c"Q@:@".as_ptr()).as_bool(){return Err("Could not install the native termination guard.".into());}
    }
    Ok(())
}
