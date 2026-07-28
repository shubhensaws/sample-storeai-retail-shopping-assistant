# Contributing guidelines

Thank you for your interest in contributing to StoreAI. Whether it's a bug report, new feature,
correction, or additional documentation, we welcome your contributions.

Please read through this document before submitting any issues or pull requests to ensure we have all
the necessary information to effectively respond to your bug report or contribution.

## Reporting bugs and feature requests

Use the GitHub issue tracker to report bugs and suggest features. Before filing, please check existing
open and recently closed issues to avoid duplicates.

A good bug report includes:

- A reproducible test case or a clear sequence of steps.
- The version or commit you are running.
- Relevant details about your environment (region, tool versions, enabled modules).
- Anything unusual about your setup.

## Contributing via pull requests

Contributions via pull requests are much appreciated. Before sending us a pull request, please ensure:

1. You are working against the latest source on the `main` branch.
2. You check existing open and recently merged pull requests to confirm the change isn't already in
   progress.
3. You open an issue to discuss any significant work — we don't want your time to be wasted.

To send us a pull request:

1. Fork the repository.
2. Modify the source, focusing on the specific change you are contributing. Reformatting all the code
   makes a pull request hard to review.
3. Ensure local builds and tests pass.
4. Commit to your fork using clear commit messages.
5. Send us a pull request, answering any default questions in the pull request interface.
6. Pay attention to any automated CI failures reported in the pull request, and stay involved in the
   conversation.

## Coding conventions

- Follow the existing style of the file you are editing.
- Keep changes focused; separate unrelated changes into separate pull requests.
- Use secure-by-default patterns (input validation, least-privilege IAM, no secrets in code).
- Update documentation in `docs/` when you change behavior, configuration, or architecture.

## Security issue notifications

If you discover a potential security issue in this project, we ask that you **do not** create a public
GitHub issue. Instead, report it privately to AWS Security through the
[vulnerability reporting page](https://aws.amazon.com/security/vulnerability-reporting/) or directly by
email to aws-security@amazon.com. Please do not create a public issue.

## Licensing

See the [LICENSE](LICENSE) file for this project's licensing. We will ask you to confirm the licensing
of your contribution. We may ask you to sign a Contributor License Agreement (CLA) for larger changes.

## Code of conduct

This project has adopted a [Code of Conduct](CODE_OF_CONDUCT.md). All contributors are expected to
follow it.
