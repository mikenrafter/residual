//! cli-help — completions / man / generate help artifacts.
//! Owned by the cli-help component; not skills-installer.

use anyhow::Result;

pub fn generate_completions() -> Result<()> {
    print!(r#"# residual fish completions
complete -c residual -f
complete -c residual -n '__fish_use_subcommand' -a 'init' -d 'Initialize residual/ directory'
complete -c residual -n '__fish_use_subcommand' -a 'add' -d 'Add entries'
complete -c residual -n '__fish_use_subcommand' -a 'list' -d 'List entries'
complete -c residual -n '__fish_use_subcommand' -a 'verify' -d 'Verify data integrity'
complete -c residual -n '__fish_use_subcommand' -a 'matrix' -d 'NKP matrix operations'
complete -c residual -n '__fish_use_subcommand' -a 'skill' -d 'Phase + installer skills'
complete -c residual -n '__fish_use_subcommand' -a 'skill-show' -d 'Show skill definition'
complete -c residual -n '__fish_use_subcommand' -a 'skill-install' -d 'Install skill to agent'
complete -c residual -n '__fish_use_subcommand' -a 'skill-data' -d 'Show skill context data'
complete -c residual -n '__fish_use_subcommand' -a 'skill-list' -d 'List all skills'
complete -c residual -n '__fish_use_subcommand' -a 'skill-check' -d 'Check installed skill version'
complete -c residual -n '__fish_use_subcommand' -a 'tag' -d 'Tag operations'
complete -c residual -n '__fish_use_subcommand' -a 'generate' -d 'Generate artifacts'
complete -c residual -n '__fish_use_subcommand' -a 'config' -d 'Show configuration'
complete -c residual -n '__fish_seen_subcommand_from skill-show skill-install skill-data skill-check skill' -a 'purpose-walk naive-draft stressor-walk integrate fmea atam'
complete -c residual -n '__fish_seen_subcommand_from skill-install' -l agent -a 'claude cursor copilot agnostic'
complete -c residual -n '__fish_seen_subcommand_from skill-install' -l global -d 'Install user-wide'
complete -c residual -n '__fish_seen_subcommand_from add' -a 'stressor purpose attractor term persona iteration'
complete -c residual -n '__fish_seen_subcommand_from list' -a 'stressors purposes attractors terminology personas iterations'
complete -c residual -n '__fish_seen_subcommand_from verify' -a 'traits links all'
complete -c residual -n '__fish_seen_subcommand_from matrix' -a 'show calc criticality ri fusion fission'
complete -c residual -n '__fish_seen_subcommand_from tag' -a 'scan report'
complete -c residual -n '__fish_seen_subcommand_from generate' -a 'completions man hook'
"#);
    Ok(())
}

pub fn generate_man() -> Result<()> {
    print!(r#".TH RESIDUAL 1 "2026" "residual 0.1.0" "NKP Residuality CLI"
.SH NAME
residual \- NKP Residuality architecture CLI
.SH SYNOPSIS
.B residual
[\fICOMMAND\fR] [\fIOPTIONS\fR]
.SH DESCRIPTION
\fBresidual\fR is a command-line tool for applying NKP (N-K-P) Residuality theory
to software architecture. It tracks stressors, attractors, purposes, and terminology,
and provides skills (AI prompts) for structured architectural reasoning.
.SH COMMANDS
.TP
.B init
Initialize the residual/ directory in the current project.
.TP
.B add \fITARGET\fR
Add a new entry. Targets: stressor, purpose, attractor, term, persona, iteration.
.TP
.B list \fITARGET\fR
List entries. Targets: stressors, purposes, attractors, terminology, personas, iterations.
.TP
.B verify \fICHECK\fR
Verify data integrity. Checks: traits, links, all. Policy from storage-config.
.TP
.B matrix \fIOP\fR
NKP matrix operations: show, calc, criticality, ri, fusion, fission.
.TP
.B skill list / show / data
Phase skills (skills-phases). Includes ATAM/FMEA prose.
.TP
.B skill install / check-install
Installer (skills-installer). \fIskill-check\fR remains an alias.
.TP
.B tag scan [\fIPATH\fR]
Scan source files for @residue: and @stressor: tags (suggestions).
.TP
.B generate completions / man
Owned by cli-help.
.TP
.B generate hook
Write the pre-commit hook (verification-git-hook).
.TP
.B config
Show the current configuration.
.SH FILES
\fI$PROJECT/residual/\fR
The project's residual data directory.
.SH AUTHOR
Mike Nrafter
"#);
    Ok(())
}
