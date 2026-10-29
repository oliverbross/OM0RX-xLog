| Check | Exit | Seconds | Result | Exact command |
| --- | ---: | ---: | --- | --- |
| RUST-FULL | 0 | 708.987 | 924 passed, 0 failed, 0 ignored, 0 filtered; 31 passed, 0 failed, 0 ignored, 0 filtered | cargo test --locked --jobs 2 |
| RUST-FEATURE-R2 | 0 | 32.127 | 931 passed, 0 failed, 0 ignored, 0 filtered | cargo test --locked --jobs 2 --bin xlog-prototype --features contesting-test |
| RUST-HAMLIB-DUMMY | 0 | 8.944 | 31 passed, 0 failed, 0 ignored, 0 filtered | cargo test --locked --jobs 2 --test hamlib_dummy -- --nocapture |
| RUST-TWO-SLOT-DUMMY | 0 | 1.39 | 1 passed, 0 failed, 0 ignored, 923 filtered | cargo test --locked --jobs 2 --bin xlog-prototype station_session::tests::opt_in_two_slot_saved_profiles_connect_real_bundled_dummy_receivers_independently -- --exact --nocapture |
| RUST-CLIPPY | 0 | 155.853 | completed; warnings retained | cargo clippy --locked --jobs 2 --all-targets |
| RUST-RELEASE | 0 | 600.335 | completed; warnings retained | cargo build --locked --release --jobs 2 |
