// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'match_result.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
  'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models',
);

/// @nodoc
mixin _$MatchResult {
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function() noMatch,
    required TResult Function(
      PrizeTier tier,
      int prizeAmount,
      String matchedDigits,
    )
    match,
  }) => throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function()? noMatch,
    TResult? Function(PrizeTier tier, int prizeAmount, String matchedDigits)?
    match,
  }) => throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function()? noMatch,
    TResult Function(PrizeTier tier, int prizeAmount, String matchedDigits)?
    match,
    required TResult orElse(),
  }) => throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(NoMatch value) noMatch,
    required TResult Function(Match value) match,
  }) => throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(NoMatch value)? noMatch,
    TResult? Function(Match value)? match,
  }) => throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(NoMatch value)? noMatch,
    TResult Function(Match value)? match,
    required TResult orElse(),
  }) => throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $MatchResultCopyWith<$Res> {
  factory $MatchResultCopyWith(
    MatchResult value,
    $Res Function(MatchResult) then,
  ) = _$MatchResultCopyWithImpl<$Res, MatchResult>;
}

/// @nodoc
class _$MatchResultCopyWithImpl<$Res, $Val extends MatchResult>
    implements $MatchResultCopyWith<$Res> {
  _$MatchResultCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of MatchResult
  /// with the given fields replaced by the non-null parameter values.
}

/// @nodoc
abstract class _$$NoMatchImplCopyWith<$Res> {
  factory _$$NoMatchImplCopyWith(
    _$NoMatchImpl value,
    $Res Function(_$NoMatchImpl) then,
  ) = __$$NoMatchImplCopyWithImpl<$Res>;
}

/// @nodoc
class __$$NoMatchImplCopyWithImpl<$Res>
    extends _$MatchResultCopyWithImpl<$Res, _$NoMatchImpl>
    implements _$$NoMatchImplCopyWith<$Res> {
  __$$NoMatchImplCopyWithImpl(
    _$NoMatchImpl _value,
    $Res Function(_$NoMatchImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of MatchResult
  /// with the given fields replaced by the non-null parameter values.
}

/// @nodoc

class _$NoMatchImpl implements NoMatch {
  const _$NoMatchImpl();

  @override
  String toString() {
    return 'MatchResult.noMatch()';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is _$NoMatchImpl);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function() noMatch,
    required TResult Function(
      PrizeTier tier,
      int prizeAmount,
      String matchedDigits,
    )
    match,
  }) {
    return noMatch();
  }

  @override
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function()? noMatch,
    TResult? Function(PrizeTier tier, int prizeAmount, String matchedDigits)?
    match,
  }) {
    return noMatch?.call();
  }

  @override
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function()? noMatch,
    TResult Function(PrizeTier tier, int prizeAmount, String matchedDigits)?
    match,
    required TResult orElse(),
  }) {
    if (noMatch != null) {
      return noMatch();
    }
    return orElse();
  }

  @override
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(NoMatch value) noMatch,
    required TResult Function(Match value) match,
  }) {
    return noMatch(this);
  }

  @override
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(NoMatch value)? noMatch,
    TResult? Function(Match value)? match,
  }) {
    return noMatch?.call(this);
  }

  @override
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(NoMatch value)? noMatch,
    TResult Function(Match value)? match,
    required TResult orElse(),
  }) {
    if (noMatch != null) {
      return noMatch(this);
    }
    return orElse();
  }
}

abstract class NoMatch implements MatchResult {
  const factory NoMatch() = _$NoMatchImpl;
}

/// @nodoc
abstract class _$$MatchImplCopyWith<$Res> {
  factory _$$MatchImplCopyWith(
    _$MatchImpl value,
    $Res Function(_$MatchImpl) then,
  ) = __$$MatchImplCopyWithImpl<$Res>;
  @useResult
  $Res call({PrizeTier tier, int prizeAmount, String matchedDigits});
}

/// @nodoc
class __$$MatchImplCopyWithImpl<$Res>
    extends _$MatchResultCopyWithImpl<$Res, _$MatchImpl>
    implements _$$MatchImplCopyWith<$Res> {
  __$$MatchImplCopyWithImpl(
    _$MatchImpl _value,
    $Res Function(_$MatchImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of MatchResult
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? tier = null,
    Object? prizeAmount = null,
    Object? matchedDigits = null,
  }) {
    return _then(
      _$MatchImpl(
        tier:
            null == tier
                ? _value.tier
                : tier // ignore: cast_nullable_to_non_nullable
                    as PrizeTier,
        prizeAmount:
            null == prizeAmount
                ? _value.prizeAmount
                : prizeAmount // ignore: cast_nullable_to_non_nullable
                    as int,
        matchedDigits:
            null == matchedDigits
                ? _value.matchedDigits
                : matchedDigits // ignore: cast_nullable_to_non_nullable
                    as String,
      ),
    );
  }
}

/// @nodoc

class _$MatchImpl implements Match {
  const _$MatchImpl({
    required this.tier,
    required this.prizeAmount,
    required this.matchedDigits,
  });

  @override
  final PrizeTier tier;
  @override
  final int prizeAmount;
  @override
  final String matchedDigits;

  @override
  String toString() {
    return 'MatchResult.match(tier: $tier, prizeAmount: $prizeAmount, matchedDigits: $matchedDigits)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$MatchImpl &&
            (identical(other.tier, tier) || other.tier == tier) &&
            (identical(other.prizeAmount, prizeAmount) ||
                other.prizeAmount == prizeAmount) &&
            (identical(other.matchedDigits, matchedDigits) ||
                other.matchedDigits == matchedDigits));
  }

  @override
  int get hashCode =>
      Object.hash(runtimeType, tier, prizeAmount, matchedDigits);

  /// Create a copy of MatchResult
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$MatchImplCopyWith<_$MatchImpl> get copyWith =>
      __$$MatchImplCopyWithImpl<_$MatchImpl>(this, _$identity);

  @override
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function() noMatch,
    required TResult Function(
      PrizeTier tier,
      int prizeAmount,
      String matchedDigits,
    )
    match,
  }) {
    return match(tier, prizeAmount, matchedDigits);
  }

  @override
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function()? noMatch,
    TResult? Function(PrizeTier tier, int prizeAmount, String matchedDigits)?
    match,
  }) {
    return match?.call(tier, prizeAmount, matchedDigits);
  }

  @override
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function()? noMatch,
    TResult Function(PrizeTier tier, int prizeAmount, String matchedDigits)?
    match,
    required TResult orElse(),
  }) {
    if (match != null) {
      return match(tier, prizeAmount, matchedDigits);
    }
    return orElse();
  }

  @override
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(NoMatch value) noMatch,
    required TResult Function(Match value) match,
  }) {
    return match(this);
  }

  @override
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(NoMatch value)? noMatch,
    TResult? Function(Match value)? match,
  }) {
    return match?.call(this);
  }

  @override
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(NoMatch value)? noMatch,
    TResult Function(Match value)? match,
    required TResult orElse(),
  }) {
    if (match != null) {
      return match(this);
    }
    return orElse();
  }
}

abstract class Match implements MatchResult {
  const factory Match({
    required final PrizeTier tier,
    required final int prizeAmount,
    required final String matchedDigits,
  }) = _$MatchImpl;

  PrizeTier get tier;
  int get prizeAmount;
  String get matchedDigits;

  /// Create a copy of MatchResult
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$MatchImplCopyWith<_$MatchImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
