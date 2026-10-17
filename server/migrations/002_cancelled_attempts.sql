-- Quitting during a level's countdown, before the dot moves, cancels the attempt at no cost.
alter table attempts drop constraint attempts_status_check;
alter table attempts add constraint attempts_status_check
  check (status in ('open', 'clear', 'death', 'quit', 'abandoned', 'cancelled'));
