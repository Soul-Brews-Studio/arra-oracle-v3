// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'draw.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
  'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models',
);

Draw _$DrawFromJson(Map<String, dynamic> json) {
  return _Draw.fromJson(json);
}

/// @nodoc
mixin _$Draw {
  DateTime get drawDate => throw _privateConstructorUsedError;
  Map<String, String> get prizes => throw _privateConstructorUsedError;
  Map<PrizeTier, List<String>> get winningNumbers =>
      throw _privateConstructorUsedError;

  /// Serializes this Draw to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of Draw
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $DrawCopyWith<Draw> get copyWith => throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $DrawCopyWith<$Res> {
  factory $DrawCopyWith(Draw value, $Res Function(Draw) then) =
      _$DrawCopyWithImpl<$Res, Draw>;
  @useResult
  $Res call({
    DateTime drawDate,
    Map<String, String> prizes,
    Map<PrizeTier, List<String>> winningNumbers,
  });
}

/// @nodoc
class _$DrawCopyWithImpl<$Res, $Val extends Draw>
    implements $DrawCopyWith<$Res> {
  _$DrawCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of Draw
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? drawDate = null,
    Object? prizes = null,
    Object? winningNumbers = null,
  }) {
    return _then(
      _value.copyWith(
            drawDate:
                null == drawDate
                    ? _value.drawDate
                    : drawDate // ignore: cast_nullable_to_non_nullable
                        as DateTime,
            prizes:
                null == prizes
                    ? _value.prizes
                    : prizes // ignore: cast_nullable_to_non_nullable
                        as Map<String, String>,
            winningNumbers:
                null == winningNumbers
                    ? _value.winningNumbers
                    : winningNumbers // ignore: cast_nullable_to_non_nullable
                        as Map<PrizeTier, List<String>>,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$DrawImplCopyWith<$Res> implements $DrawCopyWith<$Res> {
  factory _$$DrawImplCopyWith(
    _$DrawImpl value,
    $Res Function(_$DrawImpl) then,
  ) = __$$DrawImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    DateTime drawDate,
    Map<String, String> prizes,
    Map<PrizeTier, List<String>> winningNumbers,
  });
}

/// @nodoc
class __$$DrawImplCopyWithImpl<$Res>
    extends _$DrawCopyWithImpl<$Res, _$DrawImpl>
    implements _$$DrawImplCopyWith<$Res> {
  __$$DrawImplCopyWithImpl(_$DrawImpl _value, $Res Function(_$DrawImpl) _then)
    : super(_value, _then);

  /// Create a copy of Draw
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? drawDate = null,
    Object? prizes = null,
    Object? winningNumbers = null,
  }) {
    return _then(
      _$DrawImpl(
        drawDate:
            null == drawDate
                ? _value.drawDate
                : drawDate // ignore: cast_nullable_to_non_nullable
                    as DateTime,
        prizes:
            null == prizes
                ? _value._prizes
                : prizes // ignore: cast_nullable_to_non_nullable
                    as Map<String, String>,
        winningNumbers:
            null == winningNumbers
                ? _value._winningNumbers
                : winningNumbers // ignore: cast_nullable_to_non_nullable
                    as Map<PrizeTier, List<String>>,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$DrawImpl implements _Draw {
  const _$DrawImpl({
    required this.drawDate,
    required final Map<String, String> prizes,
    final Map<PrizeTier, List<String>> winningNumbers =
        const <PrizeTier, List<String>>{},
  }) : _prizes = prizes,
       _winningNumbers = winningNumbers;

  factory _$DrawImpl.fromJson(Map<String, dynamic> json) =>
      _$$DrawImplFromJson(json);

  @override
  final DateTime drawDate;
  final Map<String, String> _prizes;
  @override
  Map<String, String> get prizes {
    if (_prizes is EqualUnmodifiableMapView) return _prizes;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableMapView(_prizes);
  }

  final Map<PrizeTier, List<String>> _winningNumbers;
  @override
  @JsonKey()
  Map<PrizeTier, List<String>> get winningNumbers {
    if (_winningNumbers is EqualUnmodifiableMapView) return _winningNumbers;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableMapView(_winningNumbers);
  }

  @override
  String toString() {
    return 'Draw(drawDate: $drawDate, prizes: $prizes, winningNumbers: $winningNumbers)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$DrawImpl &&
            (identical(other.drawDate, drawDate) ||
                other.drawDate == drawDate) &&
            const DeepCollectionEquality().equals(other._prizes, _prizes) &&
            const DeepCollectionEquality().equals(
              other._winningNumbers,
              _winningNumbers,
            ));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
    runtimeType,
    drawDate,
    const DeepCollectionEquality().hash(_prizes),
    const DeepCollectionEquality().hash(_winningNumbers),
  );

  /// Create a copy of Draw
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$DrawImplCopyWith<_$DrawImpl> get copyWith =>
      __$$DrawImplCopyWithImpl<_$DrawImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$DrawImplToJson(this);
  }
}

abstract class _Draw implements Draw {
  const factory _Draw({
    required final DateTime drawDate,
    required final Map<String, String> prizes,
    final Map<PrizeTier, List<String>> winningNumbers,
  }) = _$DrawImpl;

  factory _Draw.fromJson(Map<String, dynamic> json) = _$DrawImpl.fromJson;

  @override
  DateTime get drawDate;
  @override
  Map<String, String> get prizes;
  @override
  Map<PrizeTier, List<String>> get winningNumbers;

  /// Create a copy of Draw
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$DrawImplCopyWith<_$DrawImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
