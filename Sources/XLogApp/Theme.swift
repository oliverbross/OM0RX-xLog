import AppKit
import SwiftUI

enum XLogTheme {
    static let background = Color(hex: "#07111F")
    static let surface = Color(hex: "#0B1728")
    static let raised = Color(hex: "#101F34")
    static let rule = Color(hex: "#243A55")
    static let text = Color(hex: "#E6EDF6")
    static let secondary = Color(hex: "#92A7BF")
    static let cyan = Color(hex: "#35C8F5")
    static let teal = Color(hex: "#12D6A0")
    static let amber = Color(hex: "#F3B23C")
    static let orange = Color(hex: "#FF8C00")
    static let danger = Color(hex: "#FF6B5E")
    static let pink = Color(hex: "#F47BC5")
}

enum BannerKind: Equatable {
    case success, warning, error, info

    var color: Color {
        switch self {
        case .success: return XLogTheme.teal
        case .warning: return XLogTheme.amber
        case .error: return XLogTheme.danger
        case .info: return XLogTheme.cyan
        }
    }

    var symbol: String {
        switch self {
        case .success: return "checkmark.circle.fill"
        case .warning: return "exclamationmark.triangle.fill"
        case .error: return "xmark.octagon.fill"
        case .info: return "info.circle.fill"
        }
    }
}

struct AppBanner: Equatable {
    let message: String
    let kind: BannerKind
}

struct PrimaryActionStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .fontWeight(.semibold)
            .foregroundStyle(Color(hex: "#03140F"))
            .padding(.horizontal, 13)
            .frame(minHeight: 30)
            .background(configuration.isPressed ? Color(hex: "#0FAE84") : XLogTheme.teal)
            .clipShape(RoundedRectangle(cornerRadius: 7))
            .opacity(configuration.isPressed ? 0.9 : 1)
    }
}

extension Color {
    init(hex: String) {
        let value = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var number: UInt64 = 0
        Scanner(string: value).scanHexInt64(&number)
        let red, green, blue, alpha: UInt64
        switch value.count {
        case 8: (red, green, blue, alpha) = (number >> 24, number >> 16 & 255, number >> 8 & 255, number & 255)
        default: (red, green, blue, alpha) = (number >> 16, number >> 8 & 255, number & 255, 255)
        }
        self.init(.sRGB, red: Double(red) / 255, green: Double(green) / 255, blue: Double(blue) / 255, opacity: Double(alpha) / 255)
    }
}

struct Panel<Content: View>: View {
    let title: String
    var symbol: String? = nil
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 7) {
                if let symbol { Image(systemName: symbol).foregroundStyle(XLogTheme.cyan) }
                Text(title).font(.headline)
            }
            content
        }
        .padding(14)
        .background(XLogTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(XLogTheme.rule))
    }
}

struct StatusChip: View {
    let title: String
    let detail: String
    let color: Color
    let symbol: String

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: symbol).foregroundStyle(color)
            VStack(alignment: .leading, spacing: 0) {
                Text(title).font(.caption2).foregroundStyle(XLogTheme.secondary)
                Text(detail).font(.caption.weight(.semibold)).foregroundStyle(XLogTheme.text)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

struct FieldLabel: View {
    let title: String
    var body: some View { Text(title.uppercased()).font(.caption2.weight(.semibold)).foregroundStyle(XLogTheme.secondary) }
}

struct DarkTextFieldStyle: TextFieldStyle {
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .textFieldStyle(.plain)
            .padding(.horizontal, 9)
            .frame(minHeight: 30)
            .background(XLogTheme.raised)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(XLogTheme.rule))
    }
}
