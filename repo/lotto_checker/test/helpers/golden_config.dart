import 'package:flutter/material.dart';
import 'package:golden_toolkit/golden_toolkit.dart';

/// Standard device presets for golden tests.
///
/// Currently iPhone 14 (390x844 @3x) and Pixel 7 (412x915 @2.625).
/// Keep this list small — every device multiplies golden output and CI time.
DeviceBuilder buildStandardDevices(Widget widget, {String name = 'screen'}) {
  return DeviceBuilder()
    ..overrideDevicesForAllScenarios(
      devices: const [
        Device(
          name: 'iphone_14',
          size: Size(390, 844),
          devicePixelRatio: 3.0,
        ),
        Device(
          name: 'pixel_7',
          size: Size(412, 915),
          devicePixelRatio: 2.625,
        ),
      ],
    )
    ..addScenario(name: name, widget: widget);
}
