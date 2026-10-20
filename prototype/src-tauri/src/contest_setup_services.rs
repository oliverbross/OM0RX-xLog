//! Contest Setup may navigate to existing service owners, never dispatch service I/O.
pub fn destination(
    caller: &str,
    service: &str,
    active_radio: Option<&str>,
) -> Result<&'static str, String> {
    if caller != "contest-setup" && crate::contest_setup_dialogs::kind(caller).is_none() {
        return Err("Only Contest Setup can open its shared service settings.".into());
    }
    match service {
        "Station" => Ok("station-settings"),
        "QRZ" => Ok("qrz-settings"),
        "Radio" => match active_radio {
            Some("radio1") => Ok("radio1-settings"),
            Some("radio2") => Ok("radio2-settings"),
            _ => Err("The active xLog radio is unavailable.".into()),
        },
        "CW" => Ok("cw-settings"),
        "Cluster" => Ok("cluster-settings"),
        "Integrations" => Ok("integrations-settings"),
        "Rotator" => Ok("rotor"),
        _ => Err("Unknown Contest Setup service.".into()),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn only_setup_can_navigate_to_the_finite_service_owners() {
        for (service, route) in [
            ("Station", "station-settings"),
            ("QRZ", "qrz-settings"),
            ("CW", "cw-settings"),
            ("Cluster", "cluster-settings"),
            ("Integrations", "integrations-settings"),
            ("Rotator", "rotor"),
        ] {
            assert_eq!(
                super::destination("contest-setup", service, None).unwrap(),
                route
            );
            for dialog in ["contest-setup-station", "contest-setup-configuration"] {
                assert_eq!(super::destination(dialog, service, None).unwrap(), route);
            }
            for caller in ["main", "settings", "contest--rotor", "rotor", ""] {
                assert!(super::destination(caller, service, None).is_err());
            }
        }
        for (radio, route) in [("radio1", "radio1-settings"), ("radio2", "radio2-settings")] {
            assert_eq!(
                super::destination("contest-setup", "Radio", Some(radio)).unwrap(),
                route
            );
        }
        for radio in [None, Some(""), Some("radio3")] {
            assert!(super::destination("contest-setup", "Radio", radio).is_err());
        }
        assert!(super::destination("main", "Radio", Some("radio2")).is_err());
        for invalid in [
            "",
            "settings",
            "rotor",
            "cluster_connect",
            "contest-window-cw",
            "https://example.com",
        ] {
            assert!(super::destination("contest-setup", invalid, None).is_err());
        }
    }
}
