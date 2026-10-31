import Foundation

/// Compare wire objects without platform-specific NSDictionary bridging.
/// Sorted JSON preserves array order and the distinction between booleans and numbers.
func jsonObjectsEqual(_ lhs: [String: Any], _ rhs: [String: Any]) -> Bool {
    guard JSONSerialization.isValidJSONObject(lhs), JSONSerialization.isValidJSONObject(rhs),
          let left = try? JSONSerialization.data(withJSONObject: lhs, options: [.sortedKeys]),
          let right = try? JSONSerialization.data(withJSONObject: rhs, options: [.sortedKeys]) else { return false }
    return left == right
}
