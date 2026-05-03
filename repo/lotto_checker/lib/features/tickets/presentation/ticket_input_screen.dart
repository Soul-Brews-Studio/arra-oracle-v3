import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../data/providers.dart';
import 'controllers/ticket_input_controller.dart';
import 'widgets/ticket_form.dart';

/// Add-new or edit-existing ticket screen.
///
/// When [ticketId] is non-null, the form loads that ticket on first build and
/// `save()` upserts with the original id + createdAt (edit mode).
/// When null, the form starts blank (add mode).
class TicketInputScreen extends ConsumerWidget {
  const TicketInputScreen({super.key, this.ticketId});

  final String? ticketId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(
        title: Text(ticketId == null ? 'Add ticket' : 'Edit ticket'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          tooltip: 'Back',
          onPressed: () {
            if (context.canPop()) {
              context.pop();
            } else {
              context.go('/');
            }
          },
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          child: ticketId == null
              ? TicketForm(
                  onSaved: () => _handleSaved(context),
                )
              : _EditLoader(
                  ticketId: ticketId!,
                  onSaved: () => _handleSaved(context),
                ),
        ),
      ),
    );
  }

  void _handleSaved(BuildContext context) {
    final label = ticketId == null ? 'Ticket saved' : 'Ticket updated';
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(label)));
    if (context.canPop()) {
      context.pop();
    } else {
      context.go('/');
    }
  }
}

// ── edit loader ───────────────────────────────────────────────────────────────

/// Loads the ticket by [ticketId] then inits the controller before showing
/// the form. Shows a loading spinner while fetching and an error when missing.
class _EditLoader extends ConsumerStatefulWidget {
  const _EditLoader({required this.ticketId, required this.onSaved});

  final String ticketId;
  final VoidCallback onSaved;

  @override
  ConsumerState<_EditLoader> createState() => _EditLoaderState();
}

class _EditLoaderState extends ConsumerState<_EditLoader> {
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final ticket = await ref
        .read(ticketRepositoryProvider)
        .getById(widget.ticketId);
    if (!mounted) return;
    if (ticket == null) {
      setState(() => _loaded = true);
      return;
    }
    ref
        .read(ticketInputControllerProvider.notifier)
        .initForEdit(ticket);
    setState(() => _loaded = true);
  }

  @override
  Widget build(BuildContext context) {
    if (!_loaded) {
      return const Padding(
        padding: EdgeInsets.all(48),
        child: Center(child: CircularProgressIndicator()),
      );
    }

    final state = ref.watch(ticketInputControllerProvider);
    if (!state.isEditing) {
      return const Padding(
        padding: EdgeInsets.all(24),
        child: Center(child: Text('ไม่พบตั๋วนี้')),
      );
    }

    return TicketForm(onSaved: widget.onSaved);
  }
}
