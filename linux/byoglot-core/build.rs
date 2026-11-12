use std::{env, fs, path::PathBuf};

fn main() {
    let root = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let directory = root.join("../../lib/translate/profiles");
    println!("cargo:rerun-if-changed={}", directory.display());
    let mut paths: Vec<_> = fs::read_dir(directory)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "md"))
        .collect();
    paths.sort();
    let mut generated = String::from("pub const PROFILES: &[(&str, &str)] = &[\n");
    for path in paths {
        println!("cargo:rerun-if-changed={}", path.display());
        generated.push_str(&format!(
            "({:?}, include_str!({:?})),\n",
            path.file_stem().unwrap().to_str().unwrap(),
            path.canonicalize().unwrap()
        ));
    }
    generated.push_str("];\n");
    fs::write(
        PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("profiles.rs"),
        generated,
    )
    .unwrap();
}
