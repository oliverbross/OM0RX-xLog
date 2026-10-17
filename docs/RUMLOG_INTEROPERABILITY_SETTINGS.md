# RUMlog interoperability settings

OM0RX-xLog provides one deliberately narrow RUMlog compatibility path:

```text
RUMlog Logbook/Contest UDP spots -> xLog -> embedded Remote Station Agent -> FLEX display
```

The default loopback ports are `12062` for Logbook spots and `12063` for
Contest spots. The settings preserve the eleven RUMlog spot categories and let
the operator choose each category's display priority, colour and lifetime.
Starting the listeners remains an explicit action in the main application and
requires **Remote station · embedded xCat**. The detached Settings window can
save configuration but has no listener lifecycle or station-command authority.

This bridge does not open a RUMlog `.rlog` database, import RUMlog preferences,
write contacts to RUMlog, tune a radio or key PTT. A downstream acknowledgement
means the Remote Station Agent accepted a spot command; it does not prove the
marker was visually rendered on the Maestro.

Contact exchange remains explicit ADI/ADX import and export in Logbook. Wavelog
is the only two-way synchronization authority in xLog. Operators who also let
RUMlog receive WSJT-X contacts should choose one external upload/sync owner to
avoid submitting the same QSO through two independent local logs.

WSJT-X is a separate integration. xLog listens for its UDP Logged ADIF and
bounded CQ activity on `127.0.0.1:2237` by default, or on an explicitly selected
IPv4 multicast group. The integration sends no WSJT-X packets and provides no
CAT, rig control, PTT or automatic-reply service.
