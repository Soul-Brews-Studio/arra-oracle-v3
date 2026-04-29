import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Lotto Checker'),
      ),
      body: const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            '🎟️ Phase 1: foundation ready',
            style: TextStyle(fontSize: 18),
            textAlign: TextAlign.center,
          ),
        ),
      ),
      floatingActionButton: Row(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          FloatingActionButton.extended(
            heroTag: 'home-results',
            onPressed: () => context.go('/results'),
            icon: const Icon(Icons.assignment_turned_in_outlined),
            label: const Text('ดูผล'),
          ),
          const SizedBox(width: 12),
          FloatingActionButton.extended(
            heroTag: 'home-add-ticket',
            onPressed: () => context.go('/tickets/new'),
            icon: const Icon(Icons.add),
            label: const Text('เพิ่มตั๋ว'),
          ),
        ],
      ),
    );
  }
}
