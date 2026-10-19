//! Contest Setup may navigate to existing service owners, never dispatch service I/O.
pub fn destination(caller: &str, service: &str) -> Result<&'static str, String> {
    if caller != "contest-setup" {
        return Err("Only Contest Setup can open its shared service settings.".into());
    }
    match service {
        "Station" => Ok("station-settings"),
        "QRZ" => Ok("qrz-settings"),
        "Radio" => Ok("radio1-settings"),
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
        for (service, route) in [("Station", "station-settings"), ("QRZ", "qrz-settings"),
            ("Radio", "radio1-settings"), ("CW", "cw-settings"), ("Cluster", "cluster-settings"),
            ("Integrations", "integrations-settings"), ("Rotator", "rotor")] {
            assert_eq!(super::destination("contest-setup", service).unwrap(), route);
            for caller in ["main", "settings", "contest--rotor", "rotor", ""] {
                assert!(super::destination(caller, service).is_err());
            }
        }
        for invalid in ["", "settings", "rotor", "cluster_connect", "contest-window-cw", "https://example.com"] {
            assert!(super::destination("contest-setup", invalid).is_err());
        }
    }
}
