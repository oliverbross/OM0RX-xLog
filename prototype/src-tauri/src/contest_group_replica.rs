use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::contest_group_chat::{AuthorityOperation, AuthorityRequest};

const MAX_PAGE_CHANGES: u16 = 25;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReplicaCursor {
    pub revision: u64,
    pub sequence: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SerialReservationIntent {
    pub request_id: String,
    pub frequency_hz: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyncPageRequest {
    pub operation_id: String,
    pub changes_request_id: String,
    pub expected_revision: u64,
    pub from_cursor: ReplicaCursor,
    pub limit: u16,
    pub draft_id: Option<String>,
    pub authored_qso_id: Option<String>,
    pub serial_reservation: Option<SerialReservationIntent>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPageResult {
    /// The exact local Python multi_replica_apply response. The authoritative
    /// page is deliberately not returned across the renderer boundary.
    pub apply: Value,
    pub has_more: bool,
    /// True only when this authenticated page contained and locally applied
    /// the pending renderer-authored commit.
    pub authored_applied: bool,
}

pub struct PreparedPage {
    pub request: Value,
    pub has_more: bool,
    pub authored_applied: bool,
}

pub fn validate_renderer_authority_request(operation: AuthorityOperation) -> Result<(), String> {
    if operation == AuthorityOperation::Changes {
        Err(
            "Authoritative change pages are available only to the native replica-sync owner."
                .into(),
        )
    } else {
        Ok(())
    }
}

fn valid_uuid(value: &str, name: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| format!("The replica {name} is invalid."))
}

impl SyncPageRequest {
    pub fn validate(&self) -> Result<(), String> {
        valid_uuid(&self.operation_id, "operation identity")?;
        valid_uuid(&self.changes_request_id, "changes request identity")?;
        if !(1..=MAX_PAGE_CHANGES).contains(&self.limit) {
            return Err(format!(
                "Replica pages must contain between 1 and {MAX_PAGE_CHANGES} changes."
            ));
        }
        match (&self.draft_id, &self.authored_qso_id) {
            (Some(draft), Some(qso)) => {
                valid_uuid(draft, "draft identity")?;
                valid_uuid(qso, "authored contact identity")?;
            }
            (None, None) => {}
            _ => {
                return Err(
                    "Replica authored-contact identity requires its exact local draft identity."
                        .into(),
                )
            }
        }
        if let Some(reservation) = &self.serial_reservation {
            valid_uuid(&reservation.request_id, "serial request identity")?;
            if reservation.frequency_hz == 0 || reservation.frequency_hz > 7_500_000_000_000 {
                return Err("The replica serial-reservation frequency is invalid.".into());
            }
        }
        Ok(())
    }

    pub fn changes_request(&self) -> AuthorityRequest {
        AuthorityRequest {
            request_id: self.changes_request_id.clone(),
            operation: AuthorityOperation::Changes,
            params: json!({
                "afterRevision": self.from_cursor.revision,
                "afterSequence": self.from_cursor.sequence,
                "limit": self.limit,
            }),
        }
    }

    pub fn reservation_request(&self) -> Option<AuthorityRequest> {
        self.serial_reservation
            .as_ref()
            .map(|intent| AuthorityRequest {
                request_id: intent.request_id.clone(),
                operation: AuthorityOperation::SerialReserve,
                params: json!({"frequencyHz": intent.frequency_hz}),
            })
    }

    pub fn prepare_apply(
        &self,
        local_session_id: &str,
        local_workspace_generation: &str,
        changes_reply: Value,
        reservation_reply: Option<Value>,
    ) -> Result<PreparedPage, String> {
        self.validate()?;
        let changes = authority_result(&changes_reply, &self.changes_request_id, "changes")?;
        require_reply_request_id(changes, &self.changes_request_id, "changes")?;
        require_u64(changes, "afterRevision", Some(self.from_cursor.revision))?;
        require_u64(changes, "afterSequence", Some(self.from_cursor.sequence))?;
        let next = ReplicaCursor {
            revision: require_u64(changes, "nextRevision", None)?,
            sequence: require_u64(changes, "nextSequence", None)?,
        };
        if (next.revision, next.sequence) < (self.from_cursor.revision, self.from_cursor.sequence) {
            return Err("The authoritative replica page moved its cursor backwards.".into());
        }
        let page = changes
            .get("changes")
            .and_then(Value::as_array)
            .ok_or("The authoritative replica page does not contain a change array.")?;
        if page.len() > usize::from(self.limit) {
            return Err("The authoritative replica page exceeded its requested limit.".into());
        }
        let authority = changes
            .get("authority")
            .filter(|value| value.is_object())
            .ok_or("The authoritative replica page has no authority identity.")?;
        let has_more = changes
            .get("hasMore")
            .and_then(Value::as_bool)
            .ok_or("The authoritative replica page has no paging state.")?;
        let authored_applied = self.authored_qso_id.as_ref().is_some_and(|authored| {
            page.iter().any(|change| {
                change.get("kind").and_then(Value::as_str) == Some("commit")
                    && change.get("qsoID").and_then(Value::as_str) == Some(authored.as_str())
            })
        });
        if self.authored_qso_id.is_some() && !authored_applied && !has_more {
            return Err(
                "The authoritative log reached its final page without the pending authored contact."
                    .into(),
            );
        }

        let mut params = Map::from_iter([
            ("sessionID".into(), Value::String(local_session_id.into())),
            (
                "workspaceGeneration".into(),
                Value::String(local_workspace_generation.into()),
            ),
            (
                "operationID".into(),
                Value::String(self.operation_id.clone()),
            ),
            (
                "expectedRevision".into(),
                Value::from(self.expected_revision),
            ),
            ("authority".into(), authority.clone()),
            (
                "fromCursor".into(),
                serde_json::to_value(&self.from_cursor).unwrap(),
            ),
            ("toCursor".into(), serde_json::to_value(next).unwrap()),
            ("historyComplete".into(), Value::Bool(!has_more)),
            // This is the exact authenticated page value. It is never decoded
            // into a renderer-owned representation before local application.
            ("changes".into(), Value::Array(page.clone())),
        ]);
        if authored_applied {
            let (draft, qso) = self
                .draft_id
                .as_ref()
                .zip(self.authored_qso_id.as_ref())
                .ok_or("The authored replica page lost its local draft identity.")?;
            params.insert("draftID".into(), Value::String(draft.clone()));
            params.insert("authoredQSOID".into(), Value::String(qso.clone()));
        }
        match (reservation_reply, self.serial_reservation.as_ref()) {
            (Some(reply), Some(intent)) => {
                let reservation =
                    authority_result(&reply, &intent.request_id, "serial reservation")?;
                require_reply_request_id(reservation, &intent.request_id, "serial reservation")?;
                let mut exact = Map::new();
                for key in [
                    "requestID",
                    "scope",
                    "serial",
                    "sentExchange",
                    "allocatedFieldID",
                    "authority",
                ] {
                    exact.insert(
                        key.into(),
                        reservation.get(key).cloned().ok_or_else(|| {
                            format!("The authoritative serial reservation lacks {key}.")
                        })?,
                    );
                }
                params.insert("nextReservation".into(), Value::Object(exact));
            }
            (None, None) => {}
            _ => {
                return Err("The replica serial-reservation reply did not match its intent.".into())
            }
        }
        Ok(PreparedPage {
            request: json!({
                "id": self.operation_id,
                "method": "contest_multi_replica_apply",
                "params": params,
            }),
            has_more,
            authored_applied,
        })
    }
}

fn authority_result<'a>(
    reply: &'a Value,
    request_id: &str,
    name: &str,
) -> Result<&'a Map<String, Value>, String> {
    if reply.get("id").and_then(Value::as_str) != Some(request_id) {
        return Err(format!(
            "The authoritative {name} reply was not correlated."
        ));
    }
    if reply.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(format!("The authoritative {name} request was rejected."));
    }
    reply
        .get("result")
        .and_then(Value::as_object)
        .ok_or_else(|| format!("The authoritative {name} reply has no result."))
}

fn require_reply_request_id(
    result: &Map<String, Value>,
    expected: &str,
    name: &str,
) -> Result<(), String> {
    if result.get("requestID").and_then(Value::as_str) == Some(expected) {
        Ok(())
    } else {
        Err(format!(
            "The authoritative {name} result was not correlated."
        ))
    }
}

fn require_u64(
    result: &Map<String, Value>,
    key: &str,
    expected: Option<u64>,
) -> Result<u64, String> {
    let value = result
        .get(key)
        .and_then(Value::as_u64)
        .ok_or_else(|| format!("The authoritative replica page has invalid {key}."))?;
    if expected.is_some_and(|expected| expected != value) {
        return Err(format!("The authoritative replica page mismatched {key}."));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sync() -> SyncPageRequest {
        SyncPageRequest {
            operation_id: "11111111-1111-4111-8111-111111111111".into(),
            changes_request_id: "22222222-2222-4222-8222-222222222222".into(),
            expected_revision: 7,
            from_cursor: ReplicaCursor {
                revision: 3,
                sequence: 4,
            },
            limit: 10,
            draft_id: None,
            authored_qso_id: None,
            serial_reservation: None,
        }
    }

    fn page() -> Value {
        json!({
            "id":"22222222-2222-4222-8222-222222222222", "ok":true,
            "result":{
                "requestID":"22222222-2222-4222-8222-222222222222",
                "afterRevision":3, "afterSequence":4,
                "nextRevision":5, "nextSequence":9, "hasMore":true,
                "authority":{"sessionID":"master"},
                "changes":[{"opaque":"authenticated-authority-row"}]
            }
        })
    }

    fn authored_request() -> SyncPageRequest {
        let mut request = sync();
        request.limit = 25;
        request.draft_id = Some("33333333-3333-4333-8333-333333333333".into());
        request.authored_qso_id = Some("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".into());
        request
    }

    fn authored_page(
        request: &SyncPageRequest,
        rows: Vec<Value>,
        next: ReplicaCursor,
        has_more: bool,
    ) -> Value {
        json!({
            "id":request.changes_request_id, "ok":true,
            "result":{
                "requestID":request.changes_request_id,
                "afterRevision":request.from_cursor.revision,
                "afterSequence":request.from_cursor.sequence,
                "nextRevision":next.revision, "nextSequence":next.sequence,
                "hasMore":has_more, "authority":{"sessionID":"master"}, "changes":rows
            }
        })
    }

    #[test]
    fn exact_authority_page_is_owned_by_the_local_apply_request() {
        let prepared = sync()
            .prepare_apply("local", "workspace", page(), None)
            .unwrap();
        assert!(prepared.has_more);
        assert_eq!(prepared.request["method"], "contest_multi_replica_apply");
        assert_eq!(
            prepared.request["params"]["changes"],
            page()["result"]["changes"]
        );
        assert_eq!(
            prepared.request["params"]["toCursor"],
            json!({"revision":5,"sequence":9})
        );
        assert_eq!(prepared.request["params"]["historyComplete"], false);
        assert!(prepared.request["params"].get("projection").is_none());
    }

    #[test]
    fn mismatched_page_and_renderer_authored_pairs_are_rejected() {
        let mut request = sync();
        request.draft_id = Some("33333333-3333-4333-8333-333333333333".into());
        assert!(request.validate().is_err());
        let mut reply = page();
        reply["result"]["afterSequence"] = json!(5);
        assert!(sync()
            .prepare_apply("local", "workspace", reply, None)
            .is_err());
    }

    #[test]
    fn serial_payload_is_derived_only_from_the_correlated_authority_reply() {
        let mut request = sync();
        request.serial_reservation = Some(SerialReservationIntent {
            request_id: "44444444-4444-4444-8444-444444444444".into(),
            frequency_hz: 14_025_000,
        });
        let reservation = json!({
            "id":"44444444-4444-4444-8444-444444444444", "ok":true,
            "result":{"requestID":"44444444-4444-4444-8444-444444444444",
                "scope":"contest", "serial":17, "sentExchange":"599 017",
                "allocatedFieldID":"other_1", "authority":{"sessionID":"master"},
                "replayed":false}
        });
        let prepared = request
            .prepare_apply("local", "workspace", page(), Some(reservation))
            .unwrap();
        let installed = prepared.request["params"]["nextReservation"]
            .as_object()
            .unwrap();
        assert_eq!(installed.len(), 6);
        assert_eq!(installed["serial"], 17);
        assert!(installed.get("replayed").is_none());
    }

    #[test]
    fn renderer_routes_cannot_read_or_apply_authoritative_pages() {
        assert!(validate_renderer_authority_request(AuthorityOperation::Changes).is_err());
        assert!(validate_renderer_authority_request(AuthorityOperation::ContactApply).is_ok());
        let request = json!({
            "id":"11111111-1111-4111-8111-111111111111",
            "method":"contest_multi_replica_apply", "params":{}
        });
        assert!(crate::worker::validate_surface("contest-setup", &request).is_err());
        let mut changes = request;
        changes["method"] = json!("contest_multi_changes");
        assert!(crate::worker::validate_surface("contest-setup", &changes).is_err());
    }

    #[test]
    fn authored_identity_waits_across_full_intervening_page_for_its_commit() {
        let first = authored_request();
        let intervening = (0..25)
            .map(|index| {
                json!({
                    "kind":"commit",
                    "qsoID":format!("00000000-0000-4000-8000-{index:012}")
                })
            })
            .collect();
        let first_next = ReplicaCursor {
            revision: 28,
            sequence: 29,
        };
        let prepared = first
            .prepare_apply(
                "local",
                "workspace",
                authored_page(&first, intervening, first_next.clone(), true),
                None,
            )
            .unwrap();
        assert!(!prepared.authored_applied);
        assert!(prepared.request["params"].get("draftID").is_none());
        assert!(prepared.request["params"].get("authoredQSOID").is_none());

        let mut second = authored_request();
        second.operation_id = "55555555-5555-4555-8555-555555555555".into();
        second.changes_request_id = "66666666-6666-4666-8666-666666666666".into();
        second.expected_revision = 8;
        second.from_cursor = first_next;
        let second_page = authored_page(
            &second,
            vec![json!({
                "kind":"commit", "qsoID":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
            })],
            ReplicaCursor {
                revision: 29,
                sequence: 30,
            },
            true,
        );
        let prepared = second
            .prepare_apply("local", "workspace", second_page, None)
            .unwrap();
        assert!(!prepared.authored_applied);
        assert!(prepared.request["params"].get("draftID").is_none());

        let mut third = authored_request();
        third.operation_id = "77777777-7777-4777-8777-777777777777".into();
        third.changes_request_id = "88888888-8888-4888-8888-888888888888".into();
        third.expected_revision = 9;
        third.from_cursor = ReplicaCursor {
            revision: 29,
            sequence: 30,
        };
        let target = json!({"kind":"commit","qsoID":third.authored_qso_id.clone().unwrap()});
        let third_page = authored_page(
            &third,
            vec![target],
            ReplicaCursor {
                revision: 30,
                sequence: 31,
            },
            false,
        );
        let prepared = third
            .prepare_apply("local", "workspace", third_page, None)
            .unwrap();
        assert!(prepared.authored_applied);
        assert_eq!(
            prepared.request["params"]["draftID"],
            third.draft_id.unwrap()
        );
        assert_eq!(
            prepared.request["params"]["authoredQSOID"],
            third.authored_qso_id.unwrap()
        );
    }

    #[test]
    fn final_page_without_authored_commit_fails_and_retains_pending_identity() {
        let request = authored_request();
        let reply = authored_page(
            &request,
            vec![json!({
                "kind":"commit", "qsoID":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
            })],
            ReplicaCursor {
                revision: 5,
                sequence: 6,
            },
            false,
        );
        let error = request
            .prepare_apply("local", "workspace", reply, None)
            .err()
            .unwrap();
        assert!(error.contains("without the pending authored contact"));
    }
}
