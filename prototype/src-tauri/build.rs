fn main() {
    use std::process::Command;
    let root=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let head=Command::new("git").args(["rev-parse","HEAD"]).current_dir(&root).output()
        .ok().filter(|o|o.status.success()).map(|o|String::from_utf8_lossy(&o.stdout).trim().to_owned()).unwrap_or_else(||"unknown-source".into());
    let supplied=std::env::var("XLOG_SOURCE_COMMIT").ok();
    if let Some(value)=&supplied {assert_eq!(value,&head,"Build source receipt must match current HEAD");}
    let dirty=Command::new("git").args(["status","--porcelain","--untracked-files=normal"]).current_dir(&root).output().ok().is_none_or(|o|!o.status.success()||!o.stdout.is_empty());
    let identity=if dirty{format!("{head}-dirty")}else{head};
    println!("cargo:rustc-env=XLOG_SOURCE_COMMIT={identity}");
    println!("cargo:rerun-if-env-changed=XLOG_SOURCE_COMMIT");
    tauri_build::build()
}
