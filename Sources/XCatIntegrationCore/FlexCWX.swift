import Foundation

/// Indexed CWX ownership, independent of transport and RF timing. A successful
/// command reply allocates a range; only this connection's handle may report it.
public struct FlexCWXSnapshot: Codable, Sendable, Equatable {
    public let generation: Int
    public let available: Bool
    public let reason: String
    public let job: String?
    public let accepted: Int
    public let reported: Int
    public let closed: Bool
    public init(generation: Int, available: Bool, reason: String = "", job: String? = nil, accepted: Int = 0, reported: Int = 0, closed: Bool = false) {
        self.generation=generation;self.available=available;self.reason=reason;self.job=job;self.accepted=accepted;self.reported=reported;self.closed=closed
    }
}

struct FlexCWX: Sendable {
    struct Append: Sendable, Equatable {
        let generation: Int, block: Int, ordinal: Int
        let job: String, text: String
        let finish: Bool
        var command: String { "cwx send \"\(text.replacingOccurrences(of: " ", with: "\u{7f}"))\" \(block)" }
    }
    private struct Span: Sendable { let start: Int, count: Int }
    private(set) var generation = 0
    private var handle: UInt32?
    private var subscribed = false
    private var failure = "CWX subscription and client identity are unavailable."
    private var job: String?
    private var last: Append?
    private var pending: Append?
    private var spans: [Span] = []
    private var early: [Int] = []
    private var retired: Set<String> = []
    private var nextBlock = 1
    private var highIndex = -1
    private var accepted = 0, reported = 0
    private var closed = false

    var snapshot: FlexCWXSnapshot {
        .init(generation: generation, available: subscribed && handle != nil && failure.isEmpty && retired.count < 128,
              reason: retired.count >= 128 ? "Reconnect before another live CWX job." : failure,
              job: job, accepted: accepted, reported: reported, closed: closed)
    }
    mutating func reset(generation: Int) { self = FlexCWX(); self.generation = generation }
    mutating func identify(_ handle: UInt32?) {
        if let previous=self.handle, previous != handle { invalidate("CWX client identity changed; reconnect before live typing.") }
        self.handle = handle.flatMap { $0 == 0 ? nil : $0 }
        if subscribed && self.handle != nil && failure == "CWX subscription and client identity are unavailable." { failure = "" }
    }
    mutating func subscriptionAccepted() {
        subscribed = true
        if handle != nil && failure == "CWX subscription and client identity are unavailable." { failure = "" }
    }
    mutating func retire(job retiredJob: String? = nil) {
        if let retiredJob { retired.insert(retiredJob) }
        if let job { retired.insert(job) }
        if pending != nil { invalidate("CWX was stopped before its indexed reply; reconnect before live typing. Whole-message Send remains available.") }
        job = nil; last = nil; pending = nil; spans = []; early = []
        accepted = 0; reported = 0; closed = false
    }
    mutating func invalidate(_ reason: String) { failure = reason; pending = nil; early = [] }
    mutating func prepare(generation: Int, job: String, ordinal: Int, text: String, finish: Bool) throws -> Append? {
        guard generation == self.generation, snapshot.available else { throw XCatError.server(snapshot.reason.isEmpty ? "CWX connection changed; no text was replayed." : snapshot.reason) }
        guard UUID(uuidString: job) != nil, !retired.contains(job), (1...4096).contains(ordinal), text.utf8.count <= 128,
              text.utf8.allSatisfy({ (65...90).contains($0) || (48...57).contains($0) || Array(" /?=+.,-".utf8).contains($0) }),
              !text.isEmpty || finish else { throw XCatError.server("Invalid or retired CWX append.") }
        if let last, last.job == job, last.ordinal == ordinal, last.text == text, last.finish == finish { return nil }
        guard pending == nil, !closed, (self.job == nil ? ordinal == 1 : self.job == job && ordinal == (last?.ordinal ?? 0) + 1),
              accepted + text.utf8.count <= 2048 else { throw XCatError.server("CWX job changed or is pending; use Stop without retrying.") }
        self.job = job
        let append = Append(generation: generation, block: nextBlock, ordinal: ordinal, job: job, text: text, finish: finish)
        nextBlock += 1
        if text.isEmpty { last = append; closed = finish; return nil }
        pending = append
        return append
    }
    mutating func acknowledge(_ append: Append, reply: String) throws {
        guard pending == append, generation == append.generation, job == append.job else { throw XCatError.server("CWX append was retired; no text was replayed.") }
        let fields = reply.split(separator: ",", omittingEmptySubsequences: false)
        guard fields.count == 2, let start = Int(fields[0]), let block = Int(fields[1]), block == append.block,
              start >= 0, start <= Int(Int32.max) - append.text.utf8.count, start > highIndex else {
            invalidate("CWX reply did not prove a unique indexed block. Use Stop; live typing is unavailable until reconnect.")
            throw XCatError.server(snapshot.reason)
        }
        spans.append(Span(start: start, count: append.text.utf8.count))
        highIndex = start + append.text.utf8.count - 1
        accepted += append.text.utf8.count; last = append; pending = nil; closed = append.finish
        let buffered = early; early = []
        for index in buffered { report(index) }
    }
    mutating func status(handle source: UInt32?, body: String, generation: Int) {
        guard generation == self.generation, job != nil, failure.isEmpty else { return }
        let fields = body.split(separator: " ")
        guard fields.first == "cwx" else { return }
        // Erasure changes the indexed queue and cannot be mistaken for progress.
        if fields.contains(where: { $0.hasPrefix("erase_") }) {
            invalidate("CWX queue was erased; Stop and review the message before rearming."); return
        }
        let sent = fields.filter { $0.hasPrefix("sent=") }
        guard !sent.isEmpty else { return }
        guard let source, source != 0 else {
            invalidate("CWX progress has no attributable client handle. Whole-message Send remains available."); return
        }
        guard source == handle else { return }
        guard sent.count == 1, let index = Int(sent[0].dropFirst(5)), index >= 0 else {
            invalidate("CWX character progress is malformed; use Stop."); return
        }
        if pending != nil {
            if early.contains(index) { report(index); return }
            guard early.count < 128 else { invalidate("CWX progress preceded its indexed reply beyond the bounded window; use Stop."); return }
            early.append(index)
        }
        report(index)
    }
    private mutating func report(_ index: Int) {
        var before = 0
        for span in spans {
            if (span.start..<(span.start + span.count)).contains(index) { reported = max(reported, before + index - span.start + 1); return }
            before += span.count
        }
    }
}
